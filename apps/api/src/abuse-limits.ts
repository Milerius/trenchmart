/**
 * API abuse limits (docs/ops/abuse-limits.md): Workers Rate Limiting bindings, counted at the
 * edge with no database write.
 *
 * - Reads: every GET (cache hits included) per client IP, READ_LIMITER (600 / 60 s).
 * - Writes: one binding per route group (auth, tx, verify, upload), each counted twice: per
 *   client IP and, once signed in, per wallet. These sit on top of the general write limit
 *   (RATE_LIMITER, per IP + method) and the per-API-key budget; they never replace them.
 *
 * IPv6 clients are keyed by their /64: one host usually owns the whole prefix, so keying the
 * full address would let it rotate through 2^64 buckets.
 */

export type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

export type WriteGroup = 'auth' | 'tx' | 'verify' | 'upload';

export type AbuseLimiters = Partial<Record<keyof typeof ABUSE_LIMITS, Limiter>>;

import { ABUSE_LIMITS, ABUSE_PERIOD_SEC } from '@trenchmart/shared';

export { ABUSE_LIMITS, ABUSE_PERIOD_SEC };

/** Rate-limit bucket for an IP: IPv4 as is, IPv6 reduced to its /64 prefix. */
export function ipBucket(ip: string): string {
  const raw = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!;
  if (!raw.includes(':')) return raw;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is the IPv4 client.
  const mapped = /^(?:0{0,4}:){0,5}ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw.replace(/^::/, '0:'));
  if (mapped) return mapped[1]!;
  const [head, tail] = raw.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  if (right.some((part) => part.includes('.'))) right.splice(-1, 1, '0', '0');
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g || '0', 16) || 0).toString(16))
    .join(':')}::/64`;
}

/** Write route group for a request path under /api/v1 (null: general write limit only). */
export function writeGroup(method: string, path: string): WriteGroup | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const p = path.replace(/^\/api\/v1/, '');
  if (/^\/(agent\/)?auth\//.test(p)) return 'auth';
  if (/^\/verify(\/|$)/.test(p)) return 'verify';
  if (
    p === '/files' ||
    /^\/studio\/listings\/[^/]+\/(images|content|versions)(\/|$)/.test(p) ||
    /^\/studio\/versions\/[^/]+\/reupload$/.test(p) ||
    p === '/studio/profile'
  )
    return 'upload';
  if (
    /^\/(orders|tx|supplements)(\/|$)/.test(p) ||
    /^\/agent\/(tx|orders)\//.test(p) ||
    /^\/studio\/(bond|featuring\/bookings)(\/|$)/.test(p) ||
    /^\/studio\/versions\/[^/]+\/(fee|fee-tx)$/.test(p)
  )
    return 'tx';
  return null;
}

/** Counts the request against the group's binding per IP, then per wallet. True = allowed. */
export async function allowWrite(
  limiters: AbuseLimiters | undefined,
  group: WriteGroup,
  ip: string,
  wallet: string | null | undefined,
): Promise<boolean> {
  const limiter = limiters?.[group];
  if (!limiter) return true;
  if (!(await limiter.limit({ key: `${group}:ip:${ipBucket(ip)}` })).success) return false;
  if (wallet && !(await limiter.limit({ key: `${group}:w:${wallet}` })).success) return false;
  return true;
}

/** Counts a read per IP bucket. True = allowed. */
export async function allowRead(limiters: AbuseLimiters | undefined, ip: string): Promise<boolean> {
  const limiter = limiters?.read;
  if (!limiter) return true;
  return (await limiter.limit({ key: `read:${ipBucket(ip)}` })).success;
}

export function rateLimited(scope: string): Response {
  return Response.json(
    { error: { code: 'RATE_LIMIT', message: `too many ${scope} requests, retry in a minute` } },
    { status: 429, headers: { 'retry-after': String(ABUSE_PERIOD_SEC) } },
  );
}

/**
 * Read gate for the Worker entry, ahead of the edge cache so cached reads count too. Same IP
 * rule as clientIp in app.ts: x-tm-client-ip only with the proxy secret, else CF-Connecting-IP.
 */
export async function readGate(
  request: Request,
  limiters: AbuseLimiters | undefined,
  proxySecret: string | undefined,
  safeEqual: (a: string, b: string) => boolean,
): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!limiters?.read) return null;
  const proxied = request.headers.get('x-tm-client-ip');
  const ip =
    proxied && proxySecret && safeEqual(request.headers.get('x-tm-proxy') ?? '', proxySecret)
      ? proxied.trim()
      : request.headers.get('cf-connecting-ip')?.trim() || 'local';
  return (await allowRead(limiters, ip)) ? null : rateLimited('read');
}
