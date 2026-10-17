export const LOCAL_API_URL = 'http://127.0.0.1:8787';

/**
 * The /api/v1 rewrite target is baked in when Next builds. A production build without
 * API_URL silently pointed the live site at 127.0.0.1 (Cloudflare error 1003 on every
 * API call), so a production build now refuses to start without it. Set
 * ALLOW_LOCAL_API=1 to build against a local API on purpose.
 */
export function resolveApiUrl(env: Record<string, string | undefined>, phase: string): string {
  const value = env.API_URL?.trim();
  if (value) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`API_URL is not a URL: ${value}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`API_URL must be http(s): ${value}`);
    }
    // The rewrite appends /api/v1/... to this string, so anything after the path would swallow it.
    if (
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      value.includes('?') ||
      value.includes('#')
    ) {
      throw new Error(
        `API_URL must be a plain origin or path, without credentials, query or fragment: ${value}`,
      );
    }
    return value.replace(/\/+$/, '');
  }
  if (phase === 'phase-production-build' && env.ALLOW_LOCAL_API !== '1') {
    throw new Error(
      'API_URL is required for a production build (e.g. API_URL=https://api.trenchmart.fun). ' +
        'Set ALLOW_LOCAL_API=1 to build against a local API on purpose.',
    );
  }
  return LOCAL_API_URL;
}
