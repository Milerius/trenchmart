import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * M-04: X (Twitter) OAuth 2.0 Authorization Code with PKCE. Proves the creator controls
 * the X account before its handle is shown on listings. Active once X_CLIENT_ID is set.
 */
export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_API_URL = 'https://api.x.com';
export const X_TOKEN_PATH = '/2/oauth2/token';
export const X_ME_PATH = '/2/users/me';
export const X_SCOPES = 'users.read tweet.read';
export const X_COOKIE = 'tm_x_oauth';
const TTL_MS = 10 * 60_000;

const b64url = (bytes: Buffer) => bytes.toString('base64url');

/** A dev-linked handle (POST /studio/x) carries `dev:` instead of a real X user id. */
export function xVerified(user: { x_user_id?: unknown }): boolean {
  const id = typeof user.x_user_id === 'string' ? user.x_user_id : '';
  return id !== '' && !id.startsWith('dev:');
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

/** Starts the flow: authorize URL plus a signed, short-lived cookie holding state + verifier. */
export function startXAuth(input: {
  clientId: string;
  redirectUri: string;
  userId: string;
  secret: string;
  now: Date;
}): { url: string; cookie: string } {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const payload = [state, verifier, input.userId, String(input.now.getTime() + TTL_MS)].join('.');
  const url = new URL(X_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: X_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), cookie: `${payload}.${sign(payload, input.secret)}` };
}

export type XStateFailure = 'state_missing' | 'state_mismatch' | 'state_expired';

/**
 * Checks the callback's state against the signed cookie. Returns the PKCE verifier, or why
 * the check failed: `state_missing` means the cookie never came back (lost on the way through
 * a proxy, another browser, or cookies blocked), the others a forged or stale sign-in.
 */
export function checkXState(input: {
  cookie: string | undefined;
  state: string | undefined;
  userId: string;
  secret: string;
  now: Date;
}): { ok: true; verifier: string } | { ok: false; reason: XStateFailure } {
  const parts = (input.cookie ?? '').split('.');
  if (!input.cookie) return { ok: false, reason: 'state_missing' };
  if (parts.length !== 5 || !input.state) return { ok: false, reason: 'state_mismatch' };
  const [state, verifier, userId, expires, mac] = parts as [string, string, string, string, string];
  const expected = Buffer.from(sign(parts.slice(0, 4).join('.'), input.secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: 'state_mismatch' };
  if (state !== input.state || userId !== input.userId)
    return { ok: false, reason: 'state_mismatch' };
  if (Number(expires) < input.now.getTime()) return { ok: false, reason: 'state_expired' };
  return { ok: true, verifier };
}

/**
 * Why the exchange with X failed. The profile card shows a sentence for each, so the
 * creator can tell "try again" (code_rejected, unreachable) from "the site must fix its X
 * app" (token_rejected = bad client id/secret, users_me_forbidden = X plan or scopes).
 */
export type XFailure =
  | 'token_rejected'
  | 'code_rejected'
  | 'token_failed'
  | 'users_me_forbidden'
  | 'users_me_failed'
  | 'bad_account'
  | 'unreachable'
  | 'unexpected';

export class XAuthError extends Error {
  constructor(
    public reason: XFailure,
    message: string,
  ) {
    super(message);
  }
}

/** X's error body, shortened for the log. It never echoes the client secret. */
async function xErrorText(response: Response): Promise<string> {
  const text = (await response.text().catch(() => '')).slice(0, 500);
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    return [body.error, body.error_description, body.title, body.detail]
      .filter((v) => typeof v === 'string')
      .join(': ')
      .slice(0, 200);
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 200);
  }
}

/** Exchanges the code and reads the account. Throws an XAuthError with a reason on failure. */
export async function fetchXAccount(input: {
  /** Test seam. Defaults to the global fetch, called unbound (see below). */
  fetch?: typeof fetch;
  /** X API origin; tests point it at a mock server. */
  apiUrl?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<{ id: string; username: string }> {
  // Never call `input.fetch(...)`: on Workers, invoking the global fetch as a method of
  // another object throws "Illegal invocation", which made every real callback fail
  // before X was even contacted. A plain local function call has no `this`.
  const call: typeof fetch = input.fetch ?? ((url, init) => fetch(url, init));
  const api = (input.apiUrl ?? X_API_URL).replace(/\/+$/, '');
  const send = async (step: 'token' | 'users/me', url: string, init: RequestInit) => {
    try {
      return await call(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      const { name = '', message = '' } = (err ?? {}) as Error;
      // Only a network failure or timeout is "X did not answer"; anything else is our bug.
      const network =
        name === 'TimeoutError' ||
        name === 'AbortError' ||
        /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out/i.test(message);
      throw new XAuthError(
        network ? 'unreachable' : 'unexpected',
        `${step} request failed: ${message}`,
      );
    }
  };
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  // Confidential clients authenticate with Basic auth; public clients send client_id only.
  if (input.clientSecret)
    headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`;
  const token = await send('token', `${api}${X_TOKEN_PATH}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
      client_id: input.clientId,
    }).toString(),
  });
  if (!token.ok) {
    const detail = await xErrorText(token);
    // 401 (or an explicit client error) = X does not accept the client id/secret.
    const rejected = token.status === 401 || /invalid_client|unauthorized_client/.test(detail);
    throw new XAuthError(
      rejected ? 'token_rejected' : token.status === 400 ? 'code_rejected' : 'token_failed',
      `token exchange failed (${token.status}) ${detail}`.trim(),
    );
  }
  const { access_token: accessToken } = (await token.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!accessToken) throw new XAuthError('token_failed', 'token exchange returned no access token');
  const me = await send('users/me', `${api}${X_ME_PATH}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!me.ok) {
    const detail = await xErrorText(me);
    throw new XAuthError(
      me.status === 403 ? 'users_me_forbidden' : 'users_me_failed',
      `users/me failed (${me.status}) ${detail}`.trim(),
    );
  }
  const body = (await me.json().catch(() => ({}))) as { data?: { id?: string; username?: string } };
  const id = body.data?.id;
  const username = body.data?.username;
  if (!id || !/^\d+$/.test(id) || !username || !/^[A-Za-z0-9_]{1,15}$/.test(username))
    throw new XAuthError('bad_account', 'users/me returned an unexpected account');
  return { id, username };
}
