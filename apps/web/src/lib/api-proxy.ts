import { SERVER_API_URL } from './server-api';

// Browser → trenchmart.fun/api/v1/* → API Worker. A plain rewrite would reach the API from
// Cloudflare's Worker address, so every visitor would share one rate-limit bucket (M-03).
// This proxy forwards the visitor's edge IP (CF-Connecting-IP, which clients cannot set)
// together with a shared secret the API checks before trusting it.

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'x-tm-client-ip',
  'x-tm-proxy',
  'x-tm-site-host',
]);

export async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const source = new URL(request.url);
  const target = `${SERVER_API_URL}/api/v1/${path.map(encodeURIComponent).join('/')}${source.search}`;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Which hostname the visitor is on (trenchmart.fun or devnet.trenchmart.fun): the API names
  // it in the sign-in message, but only if it is on its SIWS allow-list.
  headers.set('x-tm-site-host', source.host);
  const ip = request.headers.get('cf-connecting-ip');
  const secret = process.env.PROXY_SECRET;
  if (ip && secret) {
    headers.set('x-tm-client-ip', ip);
    headers.set('x-tm-proxy', secret);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      // Required by undici/workerd to stream a request body.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch {
    return Response.json(
      {
        error: {
          code: 'UPSTREAM',
          message: 'The marketplace API is unreachable. Try again shortly.',
        },
      },
      { status: 502 },
    );
  }
  const out = new Headers(upstream.headers);
  // fetch already decoded the body; the length and encoding no longer apply.
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
