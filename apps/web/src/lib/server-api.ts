/**
 * Public, unauthenticated API reads for server rendering (no cookies are forwarded, so
 * nothing user-specific is ever cached). TM_API_URL is baked in by next.config.ts.
 */
export const SERVER_API_URL = process.env.TM_API_URL || 'http://127.0.0.1:8787';

async function once<T>(path: string, init: RequestInit & { next?: { revalidate: number } }) {
  const response = await fetch(`${SERVER_API_URL}/api/v1${path}`, {
    ...init,
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    if (response.status !== 404) console.error('publicApi', path, 'HTTP', response.status);
    return { status: response.status, data: null };
  }
  return { status: response.status, data: (await response.json()) as T };
}

export async function publicApi<T>(
  path: string,
  revalidate = 60,
): Promise<{ status: number; data: T | null }> {
  try {
    return await once<T>(path, { next: { revalidate } });
  } catch (error) {
    // The platform fetch cache can fail on its own; fall back to a plain uncached read.
    console.error('publicApi cached read failed', path, String(error));
  }
  try {
    return await once<T>(path, { cache: 'no-store' });
  } catch (error) {
    console.error('publicApi read failed', path, String(error));
    return { status: 0, data: null };
  }
}
