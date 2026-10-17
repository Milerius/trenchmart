import { describe, expect, it } from 'vitest';
import { LOCAL_API_URL, resolveApiUrl } from './api-url';

describe('API_URL build guard', () => {
  it('fails a production build without API_URL', () => {
    expect(() => resolveApiUrl({}, 'phase-production-build')).toThrow(/API_URL is required/);
    expect(() => resolveApiUrl({ API_URL: '  ' }, 'phase-production-build')).toThrow(/required/);
  });

  it('allows a deliberate local production build', () => {
    expect(resolveApiUrl({ ALLOW_LOCAL_API: '1' }, 'phase-production-build')).toBe(LOCAL_API_URL);
  });

  it('uses the local API in dev and tests', () => {
    expect(resolveApiUrl({}, 'phase-development-server')).toBe(LOCAL_API_URL);
  });

  it('accepts and normalises a real URL, rejects junk', () => {
    expect(
      resolveApiUrl({ API_URL: 'https://api.trenchmart.fun/' }, 'phase-production-build'),
    ).toBe('https://api.trenchmart.fun');
    expect(() =>
      resolveApiUrl({ API_URL: 'api.trenchmart.fun' }, 'phase-production-build'),
    ).toThrow(/not a URL/);
    expect(() => resolveApiUrl({ API_URL: 'ftp://x' }, 'phase-production-build')).toThrow(/http/);
  });
});
