import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787';

const nextConfig: NextConfig = {
  // Playwright loads the dev server from 127.0.0.1; without this the client bundle is blocked and pages never hydrate.
  allowedDevOrigins: ['127.0.0.1'],
  // No CSP. A script-src policy that omits the extension origin blocks Phantom from
  // registering a Wallet Standard wallet, which is what made Connect look dead.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
