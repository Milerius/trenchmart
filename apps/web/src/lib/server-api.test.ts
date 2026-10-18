import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUnreachable, publicApi } from './server-api';

describe('publicApi (CodeRabbit PR #29: no 16 s stall when the API is down)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('classifies timeouts and network failures as unreachable', () => {
    expect(isUnreachable(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
    expect(isUnreachable(new TypeError('fetch failed'))).toBe(true);
    expect(isUnreachable(new Error('cache store failed'))).toBe(false);
  });

  it('does not retry after a timeout', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await publicApi('/listings/x')).toEqual({ status: 0, data: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still retries uncached after a fetch-cache error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('incremental cache unavailable'))
      .mockResolvedValueOnce(new Response('{"a":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await publicApi('/listings/x')).toEqual({ status: 200, data: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
