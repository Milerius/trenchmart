/**
 * Last studio dashboard data for this tab (memory only, never storage), keyed by wallet.
 * Coming back to /studio renders it at once and refreshes in the background, instead of
 * showing skeletons and refetching everything on every visit. Cleared on sign-out or when
 * another wallet signs in.
 */
export type StudioData<R, O, P> = { requirements: R; overview: O; payouts: P };

let entry: { wallet: string; data: StudioData<unknown, unknown, unknown> } | null = null;

export function readStudioCache<R, O, P>(wallet: string | null): StudioData<R, O, P> | null {
  if (!entry) return null;
  if (wallet !== null && entry.wallet !== wallet) return null;
  return entry.data as StudioData<R, O, P>;
}

export function writeStudioCache(wallet: string, data: StudioData<unknown, unknown, unknown>) {
  entry = { wallet, data };
}

export function clearStudioCache() {
  entry = null;
}
