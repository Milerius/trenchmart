export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: { code?: string; message?: string } }) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.code ?? 'HTTP',
      data.error?.message ?? response.statusText,
    );
  }
  return data as T;
}
