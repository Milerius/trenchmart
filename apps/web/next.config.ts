import type { NextConfig } from 'next';
import { resolveApiUrl } from './src/lib/api-url';
import { resolveCluster } from './src/lib/clusters';

export default function config(phase: string): NextConfig {
  const apiUrl = resolveApiUrl(process.env, phase);
  // Refuses NEXT_PUBLIC_CLUSTER=mainnet before NEXT_PUBLIC_MAINNET_LAUNCHED=1 (docs/ops/networks.md).
  const { cluster, mainnetLaunched } = resolveCluster(process.env);
  return {
    // Server components read public listings at render time (SSR for crawlers and no-JS clients).
    // Always defined so they inline and the other cluster's data drops out of the bundle.
    env: {
      TM_API_URL: apiUrl,
      NEXT_PUBLIC_CLUSTER: cluster.id,
      NEXT_PUBLIC_MAINNET_LAUNCHED: mainnetLaunched ? '1' : '0',
    },
    // Playwright loads the dev server from 127.0.0.1; without this the client bundle is blocked and pages never hydrate.
    allowedDevOrigins: ['127.0.0.1'],
    // No CSP. A script-src policy that omits the extension origin blocks Phantom from
    // registering a Wallet Standard wallet, which is what made Connect look dead.
    // Sign-in messages name the apex domain (SIWS_DOMAIN / APP_URL). Phantom refuses to show a sign-in
    // request whose domain differs from the page origin, so wallet connect fails on www. Send www to the apex.
    // Security headers (mainnet readiness #11). frame-ancestors/X-Frame-Options stop
    // clickjacking of wallet prompts; they do not affect wallet extension injection.
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
            {
              key: 'Content-Security-Policy',
              value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
            },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ],
        },
      ];
    },
    async redirects() {
      return [
        {
          source: '/:path*',
          has: [{ type: 'host', value: 'www.trenchmart.fun' }],
          destination: 'https://trenchmart.fun/:path*',
          permanent: true,
        },
        // Older or guessed listing URL shapes all land on the canonical /l/<slug>.
        { source: '/listing/:slug', destination: '/l/:slug', permanent: true },
        { source: '/listings/:slug', destination: '/l/:slug', permanent: true },
        // The browse page is /search; /listings was a 404 for anyone guessing the URL.
        { source: '/listings', destination: '/search', permanent: true },
      ];
    },
    // /api/v1/* is proxied by app/api/v1/[...path]/route.ts (not a rewrite) so the API can
    // see the visitor's IP for rate limiting (M-03).
  };
}
