import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * M-04: X (Twitter) OAuth 2.0 Authorization Code with PKCE. Proves the creator controls
 * the X account before its handle is shown on listings. Active once X_CLIENT_ID is set.
 */
export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const X_ME_URL = 'https://api.x.com/2/users/me';
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

/** Checks the callback's state against the signed cookie; returns the PKCE verifier. */
export function checkXState(input: {
  cookie: string | undefined;
  state: string | undefined;
  userId: string;
  secret: string;
  now: Date;
}): string | null {
  const parts = (input.cookie ?? '').split('.');
  if (parts.length !== 5 || !input.state) return null;
  const [state, verifier, userId, expires, mac] = parts as [string, string, string, string, string];
  const expected = Buffer.from(sign(parts.slice(0, 4).join('.'), input.secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (state !== input.state || userId !== input.userId) return null;
  if (Number(expires) < input.now.getTime()) return null;
  return verifier;
}

/** Exchanges the code and reads the account. Throws with a short reason on any failure. */
export async function fetchXAccount(input: {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<{ id: string; username: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  // Confidential clients authenticate with Basic auth; public clients send client_id only.
  if (input.clientSecret)
    headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`;
  const token = await input.fetch(X_TOKEN_URL, {
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
  if (!token.ok) throw new Error(`token exchange failed (${token.status})`);
  const { access_token: accessToken } = (await token.json()) as { access_token?: string };
  if (!accessToken) throw new Error('token exchange returned no access token');
  const me = await input.fetch(X_ME_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!me.ok) throw new Error(`users/me failed (${me.status})`);
  const body = (await me.json()) as { data?: { id?: string; username?: string } };
  const id = body.data?.id;
  const username = body.data?.username;
  if (!id || !/^\d+$/.test(id) || !username || !/^[A-Za-z0-9_]{1,15}$/.test(username))
    throw new Error('users/me returned an unexpected account');
  return { id, username };
}
