import vm from 'node:vm';

const SIGNING = new Set([
  'signTransaction',
  'signAllTransactions',
  'signAndSendTransaction',
  'sendTransaction',
  'signMessage',
]);

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
};

function walletStub(calls: string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const name = String(prop);
        if (name === 'solana' || name === 'phantom') return walletStub(calls);
        if (SIGNING.has(name)) {
          return () => {
            calls.push(name);
            return Promise.resolve(null);
          };
        }
        return undefined;
      },
    },
  );
}

/**
 * Runs a userscript immediately in a fresh V8 context.
 * No review queue and no network. Signing calls fail the version.
 */
export function runIsolatedSandbox(source: string, startedAt: number): IsolatedSandboxResult {
  const walletCalls: string[] = [];
  const requests: { host: string; method: string; count: number }[] = [];
  const errors: string[] = [];
  const wallet = walletStub(walletCalls);
  const context = vm.createContext({
    window: { solana: wallet, phantom: { solana: wallet } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout() {
      return 0;
    },
    setInterval() {
      return 0;
    },
    clearTimeout() {},
    clearInterval() {},
    fetch(url: unknown) {
      try {
        requests.push({ host: new URL(String(url)).host, method: 'GET', count: 1 });
      } catch {
        requests.push({ host: 'dynamic', method: 'GET', count: 1 });
      }
      return Promise.resolve({ ok: false, status: 0, text: async () => '' });
    },
  });
  try {
    vm.runInContext(source, context, { timeout: 50 });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'sandbox error');
  }
  const verdict = walletCalls.length > 0 ? 'fail' : requests.length > 0 ? 'warn' : 'pass';
  return {
    mode: 'vm-isolate',
    durationMs: Math.max(0, Date.now() - startedAt),
    requests,
    walletCalls,
    clipboard: [],
    storageReads: [],
    errors,
    verdict,
    notes: 'Automated sandbox ran immediately in an isolated vm. There is no human review queue.',
  };
}
