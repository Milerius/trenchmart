export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Extra fields from the error body, e.g. `fields` for per-field validation errors. */
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  const text = await response.text();
  let data: { error?: { code?: string; message?: string; [key: string]: unknown } } = {};
  if (text) {
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      // A proxy or platform error page, not our API. Say so instead of a JSON parse error.
      throw new ApiError(response.status, 'HTTP', `Server error (HTTP ${response.status})`);
    }
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.code ?? 'HTTP',
      data.error?.message ?? (response.statusText || `Request failed (HTTP ${response.status})`),
      data.error ?? {},
    );
  }
  return data as T;
}
