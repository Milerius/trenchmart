import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { SANDBOX_PRELUDE } from './sandbox-prelude';

/** Each sandbox check is budgeted inside the 10–20s target. */
export const SANDBOX_BUDGET_MS = 15_000;
export const SANDBOX_MEMORY_MB = 128;
/** Virtual time the timer loop may advance: timers due later never run. */
export const SANDBOX_VIRTUAL_MS = 60_000;
const MAX_TIMER_RUNS = 2_000;
const MAX_SOURCE_BYTES = 1_500_000;

export type IsolatedSandboxResult = {
  mode: 'quickjs-wasm';
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
  timerRuns?: number;
};

/**
 * The isolate engine could not start (wasm failed to load or instantiate). This says
 * nothing about the file, so the review must stay retryable instead of rejecting.
 */
export class SandboxInfraError extends Error {
  readonly infra = true;
}

let engine: Promise<QuickJSWASMModule> | null = null;

function loadEngine(): Promise<QuickJSWASMModule> {
  engine ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC).catch((err: unknown) => {
    engine = null;
    throw new SandboxInfraError(
      `sandbox engine failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  return engine;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return SANDBOX_BUDGET_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return SANDBOX_BUDGET_MS;
  return Math.min(20_000, Math.max(1, Math.round(timeoutMs)));
}

function headerValue(source: string, key: string): string | undefined {
  const header = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(source)?.[1] ?? '';
  return new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, 'm').exec(header)?.[1];
}

/** The page the script would run on: its first @match, with wildcards made concrete. */
export function sandboxPage(source: string): { href: string; host: string; origin: string } {
  const match = headerValue(source, 'match') ?? headerValue(source, 'include') ?? '';
  const concrete = match
    .replace(/^\*:\/\//, 'https://')
    .replace(/:\/\/\*\./, '://www.')
    .replace(/\*/g, '');
  try {
    const url = new URL(concrete);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    return { href: url.href, host: url.host, origin: url.origin };
  } catch {
    return { href: 'https://example.com/', host: 'example.com', origin: 'https://example.com' };
  }
}

function errorText(ctx: QuickJSContext, handle: QuickJSHandle): string {
  const dumped = ctx.dump(handle) as unknown;
  handle.dispose();
  if (dumped && typeof dumped === 'object') {
    const value = dumped as { name?: string; message?: string };
    if (value.message !== undefined)
      return `${value.name ? `${value.name}: ` : ''}${value.message}`;
  }
  return String(dumped);
}

/**
 * Runs a userscript inside a QuickJS WebAssembly isolate with a browser-like global
 * environment (DOM, timers, storage, URL, structuredClone, GM_* APIs, wallet providers).
 * The isolate has no host I/O: fetch, XHR, WebSocket, beacons and element sources are
 * stubs that log and fail closed. Execution stops at the wall-clock budget and the
 * memory limit. Works the same in Node and in Cloudflare Workers.
 */
export async function runIsolatedSandbox(
  source: string,
  startedAt: number,
  options?: { timeoutMs?: number },
): Promise<IsolatedSandboxResult> {
  const timeoutMs = clampTimeout(options?.timeoutMs);
  const limits = { timeoutMs, memoryMb: SANDBOX_MEMORY_MB };
  const walletCalls: string[] = [];
  const requestMap = new Map<string, { host: string; method: string; count: number }>();
  const errors: string[] = [];
  const clipboard: string[] = [];
  const storageReads: string[] = [];
  const log: string[] = [
    'egress blocked',
    `timeout ${timeoutMs}ms`,
    `memory ${SANDBOX_MEMORY_MB}mb`,
  ];
  const started = Date.now();
  const base = { mode: 'quickjs-wasm' as const, egress: 'blocked' as const, limits };

  if (source.length > MAX_SOURCE_BYTES) {
    return {
      ...base,
      durationMs: 0,
      requests: [],
      walletCalls,
      clipboard,
      storageReads,
      errors: ['source exceeds the sandbox memory budget'],
      verdict: 'fail',
      notes: 'Sandbox rejected the file before running it.',
      log: [...log, 'source too large'],
    };
  }

  const quickjs = await loadEngine();
  const runtime = quickjs.newRuntime();
  let timedOut = false;
  let outOfMemory = false;
  let timerRuns = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    runtime.setMemoryLimit(SANDBOX_MEMORY_MB * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
    const ctx = runtime.newContext();
    try {
      const record = ctx.newFunction('record', (kindHandle, valueHandle) => {
        const kind = ctx.getString(kindHandle);
        const value = ctx.getString(valueHandle).slice(0, 300);
        if (kind === 'wallet') {
          if (!walletCalls.includes(value)) walletCalls.push(value);
          log.push(`wallet ${value}`);
        } else if (kind === 'request') {
          const parsed = JSON.parse(value) as { method: string; host: string };
          const key = `${parsed.method} ${parsed.host}`;
          const prior = requestMap.get(key);
          if (prior) prior.count += 1;
          else requestMap.set(key, { host: parsed.host, method: parsed.method, count: 1 });
          if (!prior) log.push(`${key} blocked`);
        } else if (kind === 'error') {
          if (errors.length < 20 && !errors.includes(value)) errors.push(value);
        } else if (kind === 'clipboard') {
          if (clipboard.length < 20) clipboard.push(value);
          log.push(`clipboard ${value}`);
        } else if (kind === 'storage') {
          if (storageReads.length < 50 && !storageReads.includes(value)) storageReads.push(value);
        } else if (kind === 'dom') {
          log.push(`dom ${value}`);
        } else if (kind === 'console') {
          if (log.length < 200) log.push(`console ${value}`);
        }
      });
      const page = sandboxPage(source);
      const config = ctx.newString(
        JSON.stringify({
          ...page,
          name: headerValue(source, 'name') ?? 'userscript',
          version: headerValue(source, 'version') ?? '0',
        }),
      );
      const factory = ctx.evalCode(SANDBOX_PRELUDE, 'trenchmart-prelude.js');
      if (factory.error)
        throw new SandboxInfraError(`prelude failed: ${errorText(ctx, factory.error)}`);
      const parsedConfig = ctx.evalCode('(function (s) { return JSON.parse(s); })', 'cfg.js');
      if (parsedConfig.error) throw new SandboxInfraError('config parse failed');
      const cfg = ctx.callFunction(parsedConfig.value, ctx.undefined, config);
      parsedConfig.value.dispose();
      config.dispose();
      if (cfg.error) throw new SandboxInfraError('config parse failed');
      const controlResult = ctx.callFunction(factory.value, ctx.undefined, record, cfg.value);
      factory.value.dispose();
      cfg.value.dispose();
      record.dispose();
      if (controlResult.error) {
        throw new SandboxInfraError(`prelude failed: ${errorText(ctx, controlResult.error)}`);
      }
      const control = controlResult.value;

      const note = (message: string) => {
        if (/interrupted/i.test(message)) timedOut = true;
        else if (/out of memory/i.test(message)) outOfMemory = true;
        else if (errors.length < 20 && !errors.includes(message)) errors.push(message);
      };
      const drain = () => {
        const jobs = runtime.executePendingJobs(1_000);
        if (jobs.error) note(errorText(ctx, jobs.error));
      };
      const call = (name: string, ...args: QuickJSHandle[]) => {
        const fn = ctx.getProp(control, name);
        const result = ctx.callFunction(fn, ctx.undefined, ...args);
        fn.dispose();
        if (result.error) {
          note(errorText(ctx, result.error));
          return undefined;
        }
        const value = ctx.dump(result.value) as unknown;
        result.value.dispose();
        return value;
      };

      const script = ctx.evalCode(source, 'userscript.user.js');
      if (script.error) note(errorText(ctx, script.error));
      else script.value.dispose();
      drain();
      if (!timedOut && !outOfMemory) {
        call('ready');
        drain();
        const horizon = ctx.newNumber(SANDBOX_VIRTUAL_MS);
        const maxRuns = ctx.newNumber(MAX_TIMER_RUNS);
        while (!timedOut && !outOfMemory && Date.now() < deadline) {
          const more = call('step', horizon, maxRuns);
          drain();
          if (more !== true) break;
        }
        horizon.dispose();
        maxRuns.dispose();
        timerRuns = Number(call('runs') ?? 0);
      }
      control.dispose();
    } finally {
      ctx.dispose();
    }
  } catch (err) {
    if (err instanceof SandboxInfraError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/out of memory/i.test(message)) outOfMemory = true;
    else if (/interrupted/i.test(message)) timedOut = true;
    else throw new SandboxInfraError(`sandbox host error: ${message}`);
  } finally {
    try {
      runtime.dispose();
    } catch {
      // A runtime that hit its memory limit can fail to free cleanly; it is discarded anyway.
    }
  }

  if (timedOut) errors.push(`Script execution timed out after ${timeoutMs}ms`);
  if (outOfMemory) errors.push(`Script exceeded the ${SANDBOX_MEMORY_MB}MB memory limit`);
  const requests = [...requestMap.values()];
  const signing = walletCalls.length > 0;
  const verdict: IsolatedSandboxResult['verdict'] =
    signing || timedOut || outOfMemory
      ? 'fail'
      : errors.length > 0 || requests.length > 0 || clipboard.length > 0
        ? 'warn'
        : 'pass';
  const notes = signing
    ? 'The script called or replaced a wallet signing method in the sandbox.'
    : timedOut
      ? `Sandbox stopped the script at the ${timeoutMs}ms resource limit. No network egress.`
      : outOfMemory
        ? `Sandbox stopped the script at the ${SANDBOX_MEMORY_MB}MB memory limit.`
        : errors.length > 0
          ? 'The script threw while running in the sandbox, so part of it was not exercised. The creator must explain or fix it.'
          : 'Sandbox ran the script in a QuickJS isolate with a browser-like page. Network egress is blocked.';
  log.push(`timers run ${timerRuns}`);
  return {
    ...base,
    durationMs: Math.max(0, Date.now() - (startedAt > 0 ? Math.min(startedAt, started) : started)),
    requests,
    walletCalls,
    clipboard,
    storageReads,
    errors,
    verdict,
    notes,
    log,
    timerRuns,
  };
}
