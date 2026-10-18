/**
 * Edge cache for anonymous, public API reads (Cloudflare Cache API).
 *
 * Only GETs without a session cookie or Authorization header on an allow-listed path
 * are cached, and only 200 responses without Set-Cookie. Everything else is marked
 * `private, no-store` so no user or authed data is ever stored by a shared cache.
 */
type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type Rule = { pattern: RegExp; fresh: number; stale: number; immutable?: boolean };

const DAY = 86_400;

export const EDGE_RULES: Rule[] = [
  // Seller images are stored under a fresh UUID per upload, so the bytes never change.
  { pattern: /^\/api\/v1\/media\/[0-9a-f-]{36}$/i, fresh: 30 * DAY, stale: DAY, immutable: true },
  // On-chain proof for /verify: chain reads are cached about a minute.
  { pattern: /^\/api\/v1\/transparency$/, fresh: 60, stale: 300 },
  { pattern: /^\/api\/v1\/(categories|config\/public|stats|prices\/sol)$/, fresh: 60, stale: 600 },
  { pattern: /^\/api\/v1\/creators\/(top|[^/]+)$/, fresh: 60, stale: 600 },
  { pattern: /^\/api\/v1\/listings$/, fresh: 30, stale: 300 },
  {
    pattern: /^\/api\/v1\/listings\/[^/]+(\/(versions|reviews|report|upvotes))?$/,
    fresh: 60,
    stale: 600,
  },
];

export function ruleFor(request: Request): Rule | null {
  if (request.method !== 'GET') return null;
  if (request.headers.has('authorization')) return null;
  const cookie = request.headers.get('cookie') ?? '';
  if (/(^|;\s*)tm_session=/.test(cookie)) return null;
  const { pathname } = new URL(request.url);
  return EDGE_RULES.find((rule) => rule.pattern.test(pathname)) ?? null;
}

function publicHeaders(rule: Rule): string {
  return rule.immutable
    ? `public, max-age=${rule.fresh}, immutable`
    : `public, max-age=0, s-maxage=${rule.fresh}, stale-while-revalidate=${rule.stale}`;
}

/** Cache key: path + query + Origin (never cookies), so anonymous readers share it. */
function keyFor(request: Request): Request {
  const url = new URL(request.url);
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
