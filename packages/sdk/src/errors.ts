/** An API error: HTTP status plus the API's {"error":{"code","message"}} body. */
export class TrenchmartError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(`${code}: ${message}`);
    this.name = 'TrenchmartError';
  }
}

/** A local safety check refused to sign a transaction the API returned. */
export class UnsafeTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTransactionError';
  }
}
