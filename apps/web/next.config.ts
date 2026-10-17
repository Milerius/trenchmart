import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787';

const nextConfig: NextConfig = {
  // Playwright loads the dev server from 127.0.0.1; without this the client bundle is blocked and pages never hydrate.
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
