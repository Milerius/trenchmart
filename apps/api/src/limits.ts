import type { Deps } from './logic';

/** A Workers Rate Limiting binding (wrangler [[ratelimits]]). */
export type RateLimitBinding = { limit(input: { key: string }): Promise<{ success: boolean }> };

/**
 * Named abuse limits. Each one maps to its own Workers Rate Limiting binding in production
 * (separate namespace ids per Worker, see docs/ops/rate-limits.md); without the binding
 * (local, CI) the same budget is counted in the Postgres rate_buckets table.
 */
export const LIMITS = {
  /** POST /tx/send per signed-in wallet (I-07). */
  txSend: { binding: 'TX_SEND_LIMITER', limit: 20, periodSec: 60 },
  /** POST /auth/nonce per client IP (abuse limits, docs/04-api.md). */
  authNonce: { binding: 'AUTH_NONCE_LIMITER', limit: 20, periodSec: 60 },
} as const satisfies Record<string, { binding: string; limit: number; periodSec: 10 | 60 }>;

export type LimitName = keyof typeof LIMITS;
export type Limiters = Partial<Record<LimitName, RateLimitBinding>>;

/** Reads the limiter bindings off a Worker env object. */
export function limitersFrom(env: Record<string, unknown>): Limiters {
  const out: Limiters = {};
  for (const [name, spec] of Object.entries(LIMITS) as [LimitName, (typeof LIMITS)[LimitName]][]) {
    const binding = env[spec.binding] as RateLimitBinding | undefined;
    if (binding && typeof binding.limit === 'function') out[name] = binding;
  }
  return out;
}

/** IPv6 clients rotate inside their /64: the network is the unit, not the address. */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const clean = ip.split('%')[0]!.toLowerCase();
  if (clean.includes('.')) return null;
  const [head, tail] = clean.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  if (clean.split('::').length > 2) return null;
  const fill = clean.includes('::') ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

/** True when the request is within budget. Counts one hit for `key` under limit `name`. */
export async function hitLimit(deps: Deps, name: LimitName, key: string): Promise<boolean> {
  const binding = deps.limiters?.[name];
  const full = `${name}:${key}`;
  if (binding) return (await binding.limit({ key: full })).success;
  const spec = LIMITS[name];
  const periodMs = spec.periodSec * 1000;
  const windowStart = new Date(Math.floor(deps.now().getTime() / periodMs) * periodMs);
  const hits = await deps.sql<{ hits: number }[]>`
    insert into rate_buckets (key, window_start, hits) values (${full}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = rate_buckets.hits + 1
    returning hits
  `;
  return (hits[0]?.hits ?? 1) <= spec.limit;
}
