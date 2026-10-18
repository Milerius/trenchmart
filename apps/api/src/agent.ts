import type { Context, Hono } from 'hono';
import { z } from 'zod';
import bs58 from 'bs58';
import {
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  SYSTEM_PROGRAM,
  fromBase64,
  parseLegacyTx,
  sendRaw,
  verifyTxSignatures,
  type ParsedLegacyTx,
} from '@trenchmart/chain';
import { jsonSafe, randomNonce, verifySiwsSignature } from '@trenchmart/shared';
import { audit, ensureSnapshot, HttpError, releaseOrders, sha256Hex, type Deps } from './logic';

/**
 * Agent API (docs: /docs/agents, /llms.txt). AI agents authenticate with scoped API keys
 * minted by a wallet-signed challenge (or from the studio). Keys reuse the regular /api/v1
 * routes; this module adds key auth, scope enforcement, per-key rate limits, key
 * management, the validated broadcast relay and the single-order release.
 */

export const API_SCOPES = ['read', 'trade', 'sell', 'profile', 'review'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_KEY_PREFIX = 'tmk_';
export const MAX_ACTIVE_KEYS = 10;
export const DEFAULT_KEY_RATE = 60;
export const MAX_KEY_RATE = 300;
export const CHALLENGE_TTL_MS = 10 * 60_000;

export type ApiKeyContext = {
  id: string;
  userId: string;
  scopes: ApiScope[];
  rateLimitPerMin: number;
};

type Row = Record<string, any>;
type Vars = { Variables: { user: Row | null; apiKey: ApiKeyContext | null } };
type Ctx = Context<Vars>;

const keyName = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(48, 'name is at most 48 characters')
  .regex(/^[A-Za-z0-9 _.-]+$/, 'name may use letters, digits, space, dot, dash and underscore');
const scopeList = z
  .array(z.enum(API_SCOPES))
  .min(1, 'pick at least one scope')
  .transform((list) => API_SCOPES.filter((scope) => list.includes(scope)));
const rateLimit = z.number().int().min(1).max(MAX_KEY_RATE).optional();
const wallet = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'wallet must be a base58 public key')
  .refine((value) => {
    try {
      return bs58.decode(value).length === 32;
    } catch {
      return false;
    }
  }, 'wallet must be a base58 public key');

export const challengeBody = z.object({
  wallet,
  name: keyName,
  scopes: scopeList,
  rateLimitPerMin: rateLimit,
});
export const challengeKeyBody = z.object({
  wallet,
  nonce: z.string().regex(/^[0-9a-f]{32}$/, 'nonce is invalid'),
  signature: z.string().min(64).max(100),
});
export const studioKeyBody = z.object({
  name: keyName,
  scopes: scopeList,
  rateLimitPerMin: rateLimit,
});
export const broadcastBody = z.object({
  txBase64: z.string().min(100).max(2000),
});

/** The exact text a wallet signs to mint a key: every term of the key is in it. */
export function challengeMessage(input: {
  domain: string;
  uri: string;
  wallet: string;
  name: string;
  scopes: readonly string[];
  rateLimitPerMin: number;
  nonce: string;
  issuedAt: Date;
  cluster: string;
}): string {
  const expires = new Date(input.issuedAt.getTime() + CHALLENGE_TTL_MS);
  return [
    `${input.domain} wants you to create an API key with your Solana account:`,
    input.wallet,
    '',
    'Create a TrenchMart agent API key. This does not send a transaction.',
    '',
    `Key name: ${input.name}`,
    `Scopes: ${input.scopes.join(', ')}`,
    `Rate limit: ${input.rateLimitPerMin}/min`,
    `Cluster: ${input.cluster}`,
    `URI: ${input.uri}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join('\n');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new key: 32 random bytes. Only its SHA-256 is stored. */
export async function newApiKey(): Promise<{ key: string; prefix: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = `${API_KEY_PREFIX}${base64Url(bytes)}`;
  return { key, prefix: key.slice(0, 12), hash: await hashApiKey(key) };
}

export async function hashApiKey(key: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(key));
}

export function isApiKeyHeader(header: string | undefined): boolean {
  return /^Bearer\s+tmk_/i.test(header ?? '');
}

/**
 * Resolves `Authorization: Bearer tmk_...` to its user. Unknown, revoked and expired keys
 * all answer the same 401, so a caller learns nothing about which keys exist.
 */
export async function authenticateApiKey(
  deps: Deps,
  header: string,
): Promise<{ user: Row; key: ApiKeyContext }> {
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!/^tmk_[A-Za-z0-9_-]{43}$/.test(token))
    throw new HttpError(401, 'INVALID_API_KEY', 'API key is invalid, revoked or expired');
  const hash = await hashApiKey(token);
  const rows = await deps.sql<Row[]>`
    select k.id as key_id, k.scopes as key_scopes, k.rate_limit_per_min as key_rate,
      k.last_used_at as key_last_used, u.*
    from api_keys k join users u on u.id = k.user_id
    where k.key_hash = ${hash} and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > ${deps.now()})
  `;
  const row = rows[0];
  if (!row) throw new HttpError(401, 'INVALID_API_KEY', 'API key is invalid, revoked or expired');
  const {
    key_id: id,
    key_scopes: scopes,
    key_rate: rate,
    key_last_used: lastUsed,
    ...user
  } = row as Row;
  const now = deps.now();
  if (!lastUsed || now.getTime() - (lastUsed as Date).getTime() > 60_000) {
    await deps.sql`update api_keys set last_used_at = ${now} where id = ${id}`;
  }
  return {
    user,
    key: {
      id: id as string,
      userId: user.id as string,
      scopes: scopes as ApiScope[],
      rateLimitPerMin: rate as number,
    },
  };
}

/** What an API key needs for a route: a list of scopes (any one is enough). */
export type ScopeRule = { anyOf: ApiScope[] } | 'open' | 'denied';

/**
 * Deny-by-default scope map for API-key requests. `path` is relative to /api/v1. Admin,
 * internal, webhook, session and raw-relay routes are never reachable with a key, and key
 * management needs a studio session (an agent can only inspect or revoke its own key).
 */
export function scopeFor(method: string, path: string): ScopeRule {
  const m = method.toUpperCase();
  const p = path.replace(/\/+$/, '') || '/';
  if (m === 'OPTIONS') return 'open';
  if (/^\/(admin|internal|hooks)(\/|$)/.test(p)) return 'denied';
  if (/^\/auth(\/|$)/.test(p)) return 'denied';
  if (p === '/tx/send') return 'denied';
  if (p === '/health' || p === '/openapi.json') return 'open';
  if (/^\/agent\/auth\//.test(p)) return 'open';
  // Signed-URL file transfer: the URL signature is the authorization.
  if (p === '/files' && (m === 'GET' || m === 'PUT')) return 'open';
  if (p === '/agent/keys/self' && (m === 'GET' || m === 'DELETE')) return 'open';
  if (/^\/agent\/keys(\/|$)/.test(p)) return 'denied';
  if (p === '/agent/tx/broadcast' && m === 'POST') return { anyOf: ['trade', 'sell'] };
  if (/^\/agent\/orders\/[^/]+\/release$/.test(p) && m === 'POST') return { anyOf: ['trade'] };
  if (/^\/agent(\/|$)/.test(p)) return 'denied';
  // Profile and socials.
  if (/^\/studio\/(profile|x)(\/|$)/.test(p)) return { anyOf: ['profile'] };
  // Everything a creator does in the studio, reads included (sales, revenue, payouts).
  if (/^\/studio(\/|$)/.test(p)) return { anyOf: ['sell'] };
  // Reviews, replies, helpful votes, upvotes, reports.
  if (/^\/orders\/[^/]+\/review(-form)?$/.test(p)) return { anyOf: ['review'] };
  if (/^\/reviews\/[^/]+\/(reply|vote|report)$/.test(p) && m !== 'GET')
    return { anyOf: ['review'] };
  if (/^\/listings\/[^/]+\/(upvote|report)$/.test(p) && m === 'POST')
    return { anyOf: ['review'] };
  // Supplements are settled by buyers (verify) and sellers (daily upload limit).
  if (/^\/supplements\/[^/]+\/submitted$/.test(p) && m === 'POST')
    return { anyOf: ['trade', 'sell'] };
  if (m === 'GET') return { anyOf: ['read'] };
  if (p === '/orders' || p === '/orders/quote') return { anyOf: ['trade'] };
  if (/^\/orders\/[^/]+\/(submitted|download|dispute|dispute\/tx|updates\/.+)$/.test(p))
    return { anyOf: ['trade'] };
  if (p === '/verify' || p === '/verify/supplement') return { anyOf: ['trade'] };
  return 'denied';
}

/**
 * Per-key fixed-window limit on every request (reads included), counted in the same
 * rate_buckets table the write limiter falls back to. Returns the remaining budget.
 */
export async function consumeKeyRate(
  deps: Deps,
  key: ApiKeyContext,
): Promise<{ ok: boolean; remaining: number; resetSec: number }> {
  const now = deps.now();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const hits = await deps.sql<{ hits: number }[]>`
    insert into rate_buckets (key, window_start, hits) values (${'apikey:' + key.id}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = rate_buckets.hits + 1
    returning hits
  `;
  const used = hits[0]?.hits ?? 1;
  const resetSec = Math.ceil((windowStart.getTime() + 60_000 - now.getTime()) / 1000);
  return {
    ok: used <= key.rateLimitPerMin,
    remaining: Math.max(0, key.rateLimitPerMin - used),
    resetSec,
  };
}

function keyView(row: Row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    rateLimitPerMin: row.rate_limit_per_min,
    createdVia: row.created_via,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

async function parse<T>(schema: z.ZodType<T>, c: Ctx): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid body');
  return parsed.data;
}

function sessionUser(c: Ctx): Row {
  if (c.get('apiKey'))
    throw new HttpError(403, 'SESSION_REQUIRED', 'manage keys from the studio (wallet session)');
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'sign in required');
  if (user.banned_at) throw new HttpError(403, 'BANNED', 'this wallet is banned');
  return user;
}

async function insertKey(
  deps: Deps,
  userId: string,
  input: { name: string; scopes: ApiScope[]; rateLimitPerMin: number; via: 'studio' | 'wallet' },
) {
  // Serialize per user so two concurrent mints cannot both pass the active-key cap.
  return deps.sql.begin(async (tx) => {
    await tx`select id from users where id = ${userId} for update`;
    const active = await tx<{ count: number }[]>`
      select count(*)::int as count from api_keys where user_id = ${userId} and revoked_at is null
    `;
    if ((active[0]?.count ?? 0) >= MAX_ACTIVE_KEYS)
      throw new HttpError(
        409,
        'KEY_LIMIT',
        `a wallet can hold ${MAX_ACTIVE_KEYS} active keys; revoke one first`,
      );
    const minted = await newApiKey();
    const rows = await tx<Row[]>`
      insert into api_keys (user_id, name, prefix, key_hash, scopes, rate_limit_per_min, created_via, created_at)
      values (${userId}, ${input.name}, ${minted.prefix}, ${minted.hash}, ${tx.array(input.scopes)},
        ${input.rateLimitPerMin}, ${input.via}, ${deps.now()})
      returning *
    `;
    return { key: minted.key, row: rows[0] as Row };
  });
}

/** Programs an issued transaction may touch (defense in depth over the exact-hash match). */
function allowedPrograms(deps: Deps): Set<string> {
  const set = new Set([COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM, MEMO_PROGRAM]);
  if (deps.env.escrowProgramId) set.add(deps.env.escrowProgramId);
  return set;
}

/**
 * Checks a signed transaction before relaying it. It must parse as a legacy transaction,
 * be signed only by the caller's wallet (fee payer) with a valid signature, touch only the
 * marketplace programs, and its message must be byte-identical to one the API issued to
 * this wallet within the last few minutes.
 */
export async function validateBroadcast(
  deps: Deps,
  walletAddress: string,
  bytes: Uint8Array,
): Promise<{ parsed: ParsedLegacyTx; hash: string; kind: string }> {
  let parsed: ParsedLegacyTx;
  try {
    parsed = parseLegacyTx(bytes);
  } catch (err) {
    throw new HttpError(400, 'BAD_TX', `transaction does not parse: ${(err as Error).message}`);
  }
  if (parsed.numRequiredSignatures !== 1 || parsed.accountKeys[0] !== walletAddress)
    throw new HttpError(
      400,
      'WRONG_SIGNER',
      'the only signer and fee payer must be the wallet that owns this key',
    );
  if (!verifyTxSignatures(parsed))
    throw new HttpError(400, 'BAD_SIGNATURE', 'the transaction signature is missing or invalid');
  const programs = allowedPrograms(deps);
  for (const ix of parsed.instructions) {
    if (!programs.has(ix.programId))
      throw new HttpError(400, 'FOREIGN_PROGRAM', `instruction to an unexpected program`);
  }
  const hash = await sha256Hex(parsed.message);
  const issued = await deps.sql<Row[]>`
    select kind, expires_at, broadcast_sig from issued_txs
    where message_hash = ${hash} and wallet = ${walletAddress}
  `;
  const row = issued[0];
  if (!row)
    throw new HttpError(
      400,
      'NOT_ISSUED',
      'this transaction is not one the API built for this wallet (it was altered or never issued)',
    );
  if ((row.expires_at as Date).getTime() < deps.now().getTime())
    throw new HttpError(410, 'TX_EXPIRED', 'this transaction expired; request a fresh one');
  return { parsed, hash, kind: row.kind as string };
}

export function registerAgentRoutes(api: Hono<Vars>, deps: Deps): void {
  /** Step 1: a challenge that states every term of the key. */
  api.post('/agent/auth/challenge', async (c) => {
    const body = await parse(challengeBody, c);
    const nonce = randomNonce();
    const issuedAt = deps.now();
    const rate = body.rateLimitPerMin ?? DEFAULT_KEY_RATE;
    const message = challengeMessage({
      domain: deps.env.siwsDomain,
      uri: deps.env.siwsUri,
      wallet: body.wallet,
      name: body.name,
      scopes: body.scopes,
      rateLimitPerMin: rate,
      nonce,
      issuedAt,
      cluster: deps.env.cluster,
    });
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    await deps.sql`
      insert into agent_challenges (nonce, wallet, message, name, scopes, rate_limit_per_min, expires_at)
      values (${nonce}, ${body.wallet}, ${message}, ${body.name}, ${deps.sql.array(body.scopes)}, ${rate}, ${expiresAt})
    `;
    return c.json({ nonce, message, expiresAt: expiresAt.toISOString() });
  });

  /** Step 2: the wallet's ed25519 signature of that message mints the key (shown once). */
  api.post('/agent/auth/key', async (c) => {
    const body = await parse(challengeKeyBody, c);
    const rows = await deps.sql<Row[]>`
      select * from agent_challenges
      where nonce = ${body.nonce} and wallet = ${body.wallet} and used_at is null and expires_at > ${deps.now()}
    `;
    const challenge = rows[0];
    if (!challenge || !verifySiwsSignature(challenge.message as string, body.signature, body.wallet))
      throw new HttpError(401, 'BAD_SIGNATURE', 'signature does not match an open challenge');
    const used = await deps.sql`
      update agent_challenges set used_at = ${deps.now()} where nonce = ${body.nonce} and used_at is null returning nonce
    `;
    if (used.length === 0) throw new HttpError(401, 'NONCE_USED', 'challenge already used');
    let users = await deps.sql<Row[]>`select * from users where wallet = ${body.wallet}`;
    if (!users[0]) {
      users = await deps.sql<Row[]>`
        insert into users (wallet, roles) values (${body.wallet}, ${deps.sql.array(['buyer'])}::user_role[])
        on conflict (wallet) do update set wallet = excluded.wallet
        returning *
      `;
    }
    const user = users[0];
    if (!user) throw new HttpError(500, 'INTERNAL', 'could not create user');
    if (user.banned_at) throw new HttpError(403, 'BANNED', 'this wallet is banned');
    await ensureSnapshot(deps, body.wallet);
    const minted = await insertKey(deps, user.id as string, {
      name: challenge.name as string,
      scopes: challenge.scopes as ApiScope[],
      rateLimitPerMin: challenge.rate_limit_per_min as number,
      via: 'wallet',
    });
    await audit(deps.sql, user.id as string, 'api_key', minted.row.id as string, 'created', {
      via: 'wallet',
      scopes: challenge.scopes,
    });
    return c.json(jsonSafe({ key: minted.key, ...keyView(minted.row), wallet: body.wallet }));
  });

  // Studio (wallet session): list, create and revoke keys.
  api.get('/agent/keys', async (c) => {
    const user = sessionUser(c);
    const rows = await deps.sql<Row[]>`
      select * from api_keys where user_id = ${user.id}
      order by revoked_at is not null, created_at desc limit 50
    `;
    return c.json(jsonSafe({ keys: rows.map(keyView), maxActive: MAX_ACTIVE_KEYS }));
  });

  api.post('/agent/keys', async (c) => {
    const user = sessionUser(c);
    const body = await parse(studioKeyBody, c);
    const minted = await insertKey(deps, user.id as string, {
      name: body.name,
      scopes: body.scopes,
      rateLimitPerMin: body.rateLimitPerMin ?? DEFAULT_KEY_RATE,
      via: 'studio',
    });
    await audit(deps.sql, user.id as string, 'api_key', minted.row.id as string, 'created', {
      via: 'studio',
      scopes: body.scopes,
    });
    return c.json(jsonSafe({ key: minted.key, ...keyView(minted.row) }));
  });

  // An agent can inspect and revoke the key it is using.
  api.get('/agent/keys/self', async (c) => {
    const key = c.get('apiKey');
    const user = c.get('user');
    if (!key || !user) throw new HttpError(401, 'API_KEY_REQUIRED', 'send an API key');
    const rows = await deps.sql<Row[]>`select * from api_keys where id = ${key.id}`;
    return c.json(jsonSafe({ ...keyView(rows[0] as Row), wallet: user.wallet }));
  });

  api.delete('/agent/keys/self', async (c) => {
    const key = c.get('apiKey');
    if (!key) throw new HttpError(401, 'API_KEY_REQUIRED', 'send an API key');
    await deps.sql`update api_keys set revoked_at = ${deps.now()} where id = ${key.id} and revoked_at is null`;
    await audit(deps.sql, key.userId, 'api_key', key.id, 'revoked', { via: 'self' });
    return c.json({ ok: true });
  });

  api.delete('/agent/keys/:id', async (c) => {
    const user = sessionUser(c);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'NOT_FOUND', 'key not found');
    const rows = await deps.sql<Row[]>`
      update api_keys set revoked_at = coalesce(revoked_at, ${deps.now()})
      where id = ${id} and user_id = ${user.id} returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'key not found');
    await audit(deps.sql, user.id as string, 'api_key', id, 'revoked', { via: 'studio' });
    return c.json(jsonSafe(keyView(rows[0])));
  });

  /**
   * Validated relay: only byte-identical copies of transactions the API built for this
   * wallet, signed by it. Agents may also send the same signed bytes to their own RPC.
   */
  api.post('/agent/tx/broadcast', async (c) => {
    const user = c.get('user');
    if (!user || !c.get('apiKey')) throw new HttpError(401, 'API_KEY_REQUIRED', 'send an API key');
    const body = await parse(broadcastBody, c);
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(body.txBase64);
    } catch {
      throw new HttpError(400, 'BAD_TX', 'transaction is not base64');
    }
    const checked = await validateBroadcast(deps, user.wallet as string, bytes);
    let signature: string;
    try {
      signature = await (deps.sendTx ?? ((tx: Uint8Array) => sendRaw(deps.env.rpcUrl, tx)))(bytes);
    } catch (err) {
      throw new HttpError(502, 'RPC', err instanceof Error ? err.message : 'broadcast failed');
    }
    await deps.sql`update issued_txs set broadcast_sig = ${signature} where message_hash = ${checked.hash}`;
    return c.json({ signature, kind: checked.kind });
  });

  /**
   * Release a paid order once its escrow window has ended. `release` is permissionless on
   * chain after the window; this runs it now for one order instead of waiting for the
   * 5-minute crank. There is no early release: the program refuses it before escrow_until.
   */
  api.post('/agent/orders/:id/release', async (c) => {
    const user = c.get('user');
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'sign in required');
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'NOT_FOUND', 'order not found');
    const rows = await deps.sql<Row[]>`
      select o.*, l.creator_id from orders o join listings l on l.id = o.listing_id where o.id = ${id}
    `;
    const order = rows[0];
    if (!order || (order.buyer_id !== user.id && order.creator_id !== user.id))
      throw new HttpError(404, 'NOT_FOUND', 'order not found');
    if (order.status === 'released')
      return c.json(jsonSafe({ released: true, releaseSig: order.release_sig }));
    if (order.status !== 'paid')
      throw new HttpError(409, 'NOT_RELEASABLE', `order is ${order.status as string}`);
    if ((order.escrow_until as Date).getTime() > deps.now().getTime())
      throw new HttpError(409, 'ESCROW_WINDOW', 'the escrow window has not ended', );
    await releaseOrders(deps, { orderId: id });
    const fresh = await deps.sql<Row[]>`select status, release_sig from orders where id = ${id}`;
    const done = fresh[0]?.status === 'released';
    if (!done)
      throw new HttpError(503, 'RELEASE_PENDING', 'release did not land yet; the crank retries every 5 minutes');
    return c.json(jsonSafe({ released: true, releaseSig: fresh[0]?.release_sig ?? null }));
  });
}
