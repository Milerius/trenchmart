/**
 * Edge cache for anonymous, public API reads (Cloudflare Cache API).
 *
 * Only GETs without a session cookie or Authorization header on an allow-listed path
 * are cached, and only 200 responses without Set-Cookie. Everything else is marked
 * `private, no-store` so no user or authed data is ever stored by a shared cache.
 *
 * Exception: rules marked `shared` are reads whose handler never looks at the viewer
 * (fee config, SOL price, stats, activity, featured, leaderboard). Signed-in visitors get
 * the same shared copy instead of a fresh database read on every page; the key never
 * includes the cookie. Keep `shared` off any route that reads c.get('user').
 */
type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type Rule = {
  pattern: RegExp;
  fresh: number;
  stale: number;
  immutable?: boolean;
  /** Viewer-independent: also served to (and filled by) signed-in requests. */
  shared?: boolean;
};

const DAY = 86_400;

export const EDGE_RULES: Rule[] = [
  // Seller images are stored under a fresh UUID per upload, so the bytes never change.
  // Narrower copies (?w=480|960) are cached under their own query key; one that does not
  // exist yet answers a 302 to the original, which is never stored.
  { pattern: /^\/api\/v1\/media\/[0-9a-f-]{36}$/i, fresh: 30 * DAY, stale: DAY, immutable: true },
  // On-chain proof for /verify: chain reads are cached about a minute.
  { pattern: /^\/api\/v1\/transparency$/, fresh: 60, stale: 300, shared: true },
  // Aggregates (home stats, categories, top creators) change slowly and are the reads that
  // went cold (stats MISS 0.8 s after 10 min idle): keep a stale copy a day so the first
  // visitor after a quiet spell gets it at once while the refresh runs in the background.
  { pattern: /^\/api\/v1\/(categories|stats|creators\/top)$/, fresh: 60, stale: DAY, shared: true },
  { pattern: /^\/api\/v1\/(config\/public|prices\/sol)$/, fresh: 60, stale: 600, shared: true },
  { pattern: /^\/api\/v1\/activity$/, fresh: 30, stale: 120, shared: true },
  { pattern: /^\/api\/v1\/payouts\/recent$/, fresh: 60, stale: 300, shared: true },
  // $MART holder rewards: public epochs feed and the current epoch (viewer-independent).
  {
    pattern: /^\/api\/v1\/rewards\/(epochs\/recent|current|top)$/,
    fresh: 30,
    stale: 300,
    shared: true,
  },
  {
    pattern: /^\/api\/v1\/rewards\/wallet\/[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    fresh: 30,
    stale: 120,
    shared: true,
  },
  // Public status page: one aggregate read for everyone, refreshed about once a minute (the
  // probes run every 5 min). Viewer-independent, so signed-in visitors share the copy.
  { pattern: /^\/api\/v1\/status$/, fresh: 60, stale: 300, shared: true },
  { pattern: /^\/api\/v1\/(featured|featuring\/config)$/, fresh: 60, stale: 300, shared: true },
  // The OpenAPI document changes only on deploy; agents fetch it often.
  { pattern: /^\/api\/v1\/openapi\.json$/, fresh: 300, stale: DAY, shared: true },
  { pattern: /^\/api\/v1\/creators\/leaderboard$/, fresh: 60, stale: 600, shared: true },
  { pattern: /^\/api\/v1\/creators\/[^/]+$/, fresh: 60, stale: 600 },
  { pattern: /^\/api\/v1\/listings$/, fresh: 30, stale: 300 },
  {
    pattern: /^\/api\/v1\/listings\/[^/]+(\/(versions|reviews|report|upvotes))?$/,
    fresh: 60,
    stale: 600,
  },
];

export function ruleFor(request: Request): Rule | null {
  if (request.method !== 'GET') return null;
  const { pathname } = new URL(request.url);
  const rule = EDGE_RULES.find((r) => r.pattern.test(pathname)) ?? null;
  if (!rule) return null;
  const cookie = request.headers.get('cookie') ?? '';
  const authed = request.headers.has('authorization') || /(^|;\s*)tm_session=/.test(cookie);
  return authed && !rule.shared ? null : rule;
}

function publicHeaders(rule: Rule): string {
  return rule.immutable
    ? `public, max-age=${rule.fresh}, immutable`
    : `public, max-age=0, s-maxage=${rule.fresh}, stale-while-revalidate=${rule.stale}`;
}

/**
 * Bumped when stored entries must not be served any more. 2: listing images were re-encoded
 * to WebP in place, but colos kept serving the old PNG bytes (354 KB) for the immutable window.
 */
export const EDGE_CACHE_VERSION = '2';

/** Cache key: path + query + Origin (never cookies), so anonymous readers share it. */
export function keyFor(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.set('__v', EDGE_CACHE_VERSION);
  // CORS headers depend on the Origin, so it is part of the key.
  url.searchParams.set('__origin', request.headers.get('origin') ?? '');
  url.searchParams.sort();
  return new Request(url.toString(), { method: 'GET' });
}

const STORED_AT = 'x-tm-stored-at';

export async function withEdgeCache(
  request: Request,
  handle: () => Promise<Response>,
  waitUntil: (p: Promise<unknown>) => void,
  cache: CacheLike | null,
  now: () => number = Date.now,
): Promise<Response> {
  const rule = ruleFor(request);
  if (!rule || !cache) return markPrivate(await handle());
  const key = keyFor(request);

  const refresh = async (): Promise<Response> => {
    const fresh = await handle();
    const own = fresh.headers.get('cache-control') ?? '';
    if (fresh.status !== 200 || fresh.headers.has('set-cookie') || /private|no-store/.test(own))
      return markPrivate(fresh);
    const headers = new Headers(fresh.headers);
    headers.set('cache-control', publicHeaders(rule));
    const body = await fresh.arrayBuffer();
    const stored = new Headers(headers);
    stored.set(STORED_AT, String(now()));
    // The Cache API keeps an entry for its max-age: fresh window plus the stale window.
    stored.set('cache-control', `public, max-age=${rule.fresh + rule.stale}`);
    waitUntil(cache.put(key, new Response(body, { status: 200, headers: stored })));
    headers.set('x-edge-cache', 'MISS');
    return new Response(body, { status: 200, headers });
  };

  const hit = await cache.match(key);
  if (!hit) return refresh();
  const age = (now() - Number(hit.headers.get(STORED_AT) ?? 0)) / 1000;
  const headers = new Headers(hit.headers);
  headers.delete(STORED_AT);
  headers.set('cache-control', publicHeaders(rule));
  if (age > rule.fresh) {
    // Serve the stale copy now and refresh in the background.
    waitUntil(refresh().catch(() => undefined));
    headers.set('x-edge-cache', 'STALE');
  } else headers.set('x-edge-cache', 'HIT');
  return new Response(hit.body, { status: hit.status, headers });
}

function markPrivate(response: Response): Response {
  if (response.headers.get('cache-control')) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
