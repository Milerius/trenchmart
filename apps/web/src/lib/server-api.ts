/**
 * Public, unauthenticated API reads for server rendering (no cookies are forwarded, so
 * nothing user-specific is ever cached). TM_API_URL is baked in by next.config.ts.
 */
export const SERVER_API_URL = process.env.TM_API_URL || 'http://127.0.0.1:8787';

export async function publicApi<T>(
  path: string,
  revalidate = 60,
): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(`${SERVER_API_URL}/api/v1${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { status: response.status, data: null };
    return { status: response.status, data: (await response.json()) as T };
  } catch {
    return { status: 0, data: null };
  }
}
