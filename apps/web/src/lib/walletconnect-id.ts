/**
 * The WalletConnect project id, split from walletconnect.ts so the app shell can decide
 * whether to show the WalletConnect row without loading the pairing and signing code.
 */

/**
 * Public Reown project id (cloud.reown.com). The allowed origin is https://trenchmart.fun.
 * An explicit empty or ${...} value hides WalletConnect. An unset env var uses this default.
 */
export const WALLETCONNECT_PROJECT_ID = '9e9aab84f03d9799c7a3dc4ee77fa93b';

declare global {
  interface Window {
    /** Set by tests. When present, even as '', it overrides the env and the default. */
    __TRENCHMART_WC_PROJECT_ID__?: string;
  }
}

/** Empty string disables the row. Null means the value was never set. */
export function normalizeProjectId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = value.trim();
  if (!raw || raw.includes('${')) return '';
  return raw;
}

export function walletConnectProjectId(): string {
  if (typeof window !== 'undefined' && '__TRENCHMART_WC_PROJECT_ID__' in window) {
    return normalizeProjectId(window.__TRENCHMART_WC_PROJECT_ID__) ?? '';
  }
  const fromEnv = normalizeProjectId(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);
  if (fromEnv === '') return '';
  if (fromEnv) return fromEnv;
  return WALLETCONNECT_PROJECT_ID;
}
