import { runIsolatedSandbox, type IsolatedSandboxResult } from '@trenchmart/scanner';

export type SandboxQueue = { send(body: unknown): Promise<void> };

export type SandboxDispatchInput = {
  runnerUrl: string;
  token: string;
  versionId: string;
  fileName: string;
  source: string;
  timeoutMs: number;
  nowMs: number;
  queue?: SandboxQueue;
  fetchImpl?: typeof fetch;
};

/**
 * Starts a sandbox job at once. A configured runner gets one webhook POST.
 * A configured queue gets one push. Nothing sleeps and nothing polls.
 */
export async function dispatchSandbox(input: SandboxDispatchInput): Promise<IsolatedSandboxResult> {
  const timeoutMs = input.timeoutMs;
  if (input.queue) {
    await input.queue.send({
      versionId: input.versionId,
      fileName: input.fileName,
      timeoutMs,
      dispatchedAt: new Date(input.nowMs).toISOString(),
    });
  }
  if (!input.runnerUrl) {
    return runIsolatedSandbox(input.source, input.nowMs, { timeoutMs });
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.runnerUrl.replace(/\/$/, '')}/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      versionId: input.versionId,
      fileName: input.fileName,
      source: input.source,
      timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 1_000),
  });
  if (!response.ok) {
    throw new Error(`sandbox runner rejected the job (${response.status})`);
  }
  const raw = (await response.json()) as IsolatedSandboxResult;
  return {
    ...raw,
    egress: 'blocked',
    limits: raw.limits ?? { timeoutMs, memoryMb: 128 },
    log: raw.log ?? [],
  };
}
