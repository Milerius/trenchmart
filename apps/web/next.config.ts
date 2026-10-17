import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787';

const nextConfig: NextConfig = {
  // Playwright loads the dev server from 127.0.0.1; without this the client bundle is blocked and pages never hydrate.
  allowedDevOrigins: ['127.0.0.1'],
  // Sign-in messages name the apex domain (SIWS_DOMAIN / APP_URL). Phantom refuses to show a sign-in
  // request whose domain differs from the page origin, so wallet connect fails on www. Send www to the apex.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.trenchmart.fun' }],
        destination: 'https://trenchmart.fun/:path*',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
