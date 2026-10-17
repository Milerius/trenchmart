import { describe, expect, it } from 'vitest';
import { closeAfterResponse } from './lifetime';

function harness() {
  const pending: Promise<unknown>[] = [];
  let closed = 0;
  return {
    close: async () => {
      closed += 1;
    },
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    closed: () => closed,
    settle: () => Promise.all(pending),
  };
}

describe('closeAfterResponse', () => {
  it('closes immediately for a response without a body', async () => {
    const h = harness();
    const res = closeAfterResponse(new Response(null, { status: 204 }), h.close, h.waitUntil);
    await h.settle();
    expect(res.status).toBe(204);
    expect(h.closed()).toBe(1);
  });

  it('keeps the connection open until a streamed body has finished', async () => {
    const h = harness();
    let push: ((chunk: string) => void) | undefined;
    let finish: (() => void) | undefined;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(encoder.encode(chunk));
        finish = () => controller.close();
      },
    });
    const res = closeAfterResponse(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      h.close,
      h.waitUntil,
    );
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = res.text();
    push?.('event: static\n\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.closed()).toBe(0);
    push?.('event: done\n\n');
    finish?.();
    expect(await text).toBe('event: static\n\nevent: done\n\n');
    await h.settle();
    expect(h.closed()).toBe(1);
  });

  it('still closes when the client disconnects mid-stream', async () => {
    const h = harness();
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const res = closeAfterResponse(new Response(body), h.close, h.waitUntil);
    await res.body?.cancel();
    await h.settle();
    expect(h.closed()).toBe(1);
  });
});
