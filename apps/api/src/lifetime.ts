type WaitUntil = (p: Promise<unknown>) => void;

/**
 * Run `close` only once the response is fully sent. A streamed body (the SSE review feed)
 * is still being produced after the handler returns, so closing the database when the
 * handler returns cuts the stream off mid-review ("write CONNECTION_ENDED").
 */
export function closeAfterResponse(
  response: Response,
  close: () => Promise<unknown>,
  waitUntil: WaitUntil,
): Response {
  if (!response.body) {
    waitUntil(close());
    return response;
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  waitUntil(
    response.body
      .pipeTo(writable)
      // A client that disconnects aborts the pipe; the connection must still be closed.
      .catch(() => undefined)
      .finally(close),
  );
  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
