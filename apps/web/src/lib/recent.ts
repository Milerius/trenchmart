/**
 * The last answer of a few public, edge-cached reads (home listings, stats, top creators,
 * activity, featured), kept in this tab's memory only. Coming back to a page paints those
 * at once and refreshes them behind, instead of skeletons for one API round trip.
 * A read that depends on the signed-in viewer (home listings: tier-gated fields) must put
 * the wallet in its key. Never share these across tabs or storage. On the server this is a
 * no-op: a module-level map there would be shared across visitors.
 */
const MAX_AGE_MS = 10 * 60_000;
const MAX_ENTRIES = 50;
const entries = new Map<string, { at: number; value: unknown }>();

export function recentRead<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > MAX_AGE_MS) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function rememberRead<T>(key: string, value: T): T {
  if (typeof window === 'undefined') return value;
  entries.delete(key);
  entries.set(key, { at: Date.now(), value });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  return value;
}

/** Test hook. */
export function forgetReads() {
  entries.clear();
}
