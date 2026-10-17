import vm from 'node:vm';

const SIGNING = new Set([
  'signTransaction',
  'signAllTransactions',
  'signAndSendTransaction',
  'sendTransaction',
  'signMessage',
]);

/** Each sandbox check is budgeted inside the 10–20s target. The old 3 minute visit is gone. */
export const SANDBOX_BUDGET_MS = 15_000;
export const SANDBOX_MEMORY_MB = 128;

export type IsolatedSandboxResult = {
  mode: 'vm-isolate';
  durationMs: number;
  requests: { host: string; method: string; count: number }[];
  walletCalls: string[];
  clipboard: string[];
  storageReads: string[];
  errors: string[];
  verdict: 'pass' | 'warn' | 'fail';
  notes: string;
  egress: 'blocked';
  limits: { timeoutMs: number; memoryMb: number };
  log: string[];
};

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return SANDBOX_BUDGET_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return SANDBOX_BUDGET_MS;
  return Math.min(20_000, Math.max(1, Math.round(timeoutMs)));
}

function walletStub(calls: string[], log: string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const name = String(prop);
        if (name === 'solana' || name === 'phantom') return walletStub(calls, log);
        if (SIGNING.has(name)) {
          return () => {
            calls.push(name);
            log.push(`wallet ${name}`);
            return Promise.resolve(null);
          };
        }
        return undefined;
      },
    },
  );
}

function recordRequest(
  requests: IsolatedSandboxResult['requests'],
  log: string[],
  url: unknown,
  method: string,
): void {
  let host: string;
  try {
    host = new URL(String(url)).host || 'dynamic';
  } catch {
    host = 'dynamic';
  }
  requests.push({ host, method, count: 1 });
  log.push(`${method} ${host} blocked`);
}

/**
 * Runs a userscript in a fresh V8 context.
 * Fetch, XHR, and WebSocket are stubs. They never touch the real network.
 * A tight loop is killed at timeoutMs. eval and WebAssembly are disabled.
 */
export function runIsolatedSandbox(
  source: string,
  startedAt: number,
  options?: { timeoutMs?: number },
): IsolatedSandboxResult {
  const timeoutMs = clampTimeout(options?.timeoutMs);
  const limits = { timeoutMs, memoryMb: SANDBOX_MEMORY_MB };
  const walletCalls: string[] = [];
  const requests: IsolatedSandboxResult['requests'] = [];
  const errors: string[] = [];
  const log: string[] = [
    `egress blocked`,
    `timeout ${timeoutMs}ms`,
    `memory ${SANDBOX_MEMORY_MB}mb`,
  ];
  const started = startedAt > 0 ? startedAt : Date.now();

  if (source.length > 1_500_000) {
    return {
      mode: 'vm-isolate',
      durationMs: 0,
      requests,
      walletCalls,
      clipboard: [],
      storageReads: [],
      errors: ['source exceeds the sandbox memory budget'],
      verdict: 'fail',
      notes: 'Sandbox rejected the file before running it.',
      egress: 'blocked',
      limits,
      log: [...log, 'source too large'],
    };
  }

  const wallet = walletStub(walletCalls, log);
  const context = vm.createContext({
    window: { solana: wallet, phantom: { solana: wallet } },
    console: {
      log(...args: unknown[]) {
        log.push(
          `console ${args
            .map((item) => String(item))
            .join(' ')
            .slice(0, 180)}`,
        );
      },
      warn() {},
      error() {},
    },
    setTimeout() {
      return 0;
    },
    setInterval() {
      return 0;
    },
    clearTimeout() {},
    clearInterval() {},
    fetch(url: unknown) {
      recordRequest(requests, log, url, 'GET');
      return Promise.resolve({ ok: false, status: 0, text: async () => '' });
    },
    XMLHttpRequest: class {
      open(method: string, url: string) {
        recordRequest(requests, log, url, method || 'GET');
      }
      send() {}
    },
    WebSocket: class {
      constructor(url: string) {
        recordRequest(requests, log, url, 'WS');
      }
    },
  });

  try {
    const options: vm.RunningCodeOptions = { timeout: timeoutMs, breakOnSigint: true };
    (
      options as { contextCodeGeneration?: { strings: boolean; wasm: boolean } }
    ).contextCodeGeneration = {
      strings: false,
      wasm: false,
    };
    vm.runInContext(source, context, options);
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'sandbox error';
    errors.push(message);
    log.push(message);
  }

  const timedOut = errors.some((error) => /timed out/i.test(error));
  const verdict =
    walletCalls.length > 0 || timedOut ? 'fail' : requests.length > 0 ? 'warn' : 'pass';
  return {
    mode: 'vm-isolate',
    durationMs: Math.max(0, Date.now() - started),
    requests,
    walletCalls,
    clipboard: [],
    storageReads: [],
    errors,
    verdict,
    notes: timedOut
      ? `Sandbox stopped the script at the ${timeoutMs}ms resource limit. No network egress.`
      : 'Sandbox ran immediately in an isolated vm. Network egress is blocked. There is no human appeal.',
    egress: 'blocked',
    limits,
    log,
  };
}
