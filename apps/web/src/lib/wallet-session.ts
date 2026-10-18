/**
 * Persist a signer only after sign-in finishes. A failed finish leaves the previous
 * signer and the remembered wallet untouched.
 */
export async function commitAfterSignIn(input: {
  finish: () => Promise<void>;
  commit: () => void;
}): Promise<void> {
  await input.finish();
  input.commit();
}

/**
 * `/auth/verify` sets the session cookie before `/me` is read. If that read fails,
 * clear the cookie this attempt just set and surface the original error.
 */
export async function sessionAfterVerify(input: {
  load: () => Promise<void>;
  rollback: () => Promise<void>;
}): Promise<void> {
  try {
    await input.load();
  } catch (err) {
    await input.rollback().catch(() => undefined);
    throw err;
  }
}

export type SessionUser = {
  id: string;
  wallet: string;
  handle: string | null;
  roles: string[];
  tier: string;
};

/** A non-secret copy of who is signed in, so pages render signed-in before /me answers. */
export type SessionHint = { user: SessionUser; expiresAt: string | null };

export const SESSION_HINT_KEY = 'tm.session';

export function readSessionHint(storage: Storage | null, now = Date.now()): SessionHint | null {
  try {
    const raw = storage?.getItem(SESSION_HINT_KEY);
    if (!raw) return null;
    const hint = JSON.parse(raw) as Partial<SessionHint>;
    const user = hint.user;
    if (!user || typeof user.wallet !== 'string' || typeof user.id !== 'string') return null;
    if (hint.expiresAt && Date.parse(hint.expiresAt) <= now) return null;
    return {
      user: {
        id: user.id,
        wallet: user.wallet,
        handle: typeof user.handle === 'string' ? user.handle : null,
        roles: Array.isArray(user.roles) ? user.roles : [],
        tier: typeof user.tier === 'string' ? user.tier : 'none',
      },
      expiresAt: hint.expiresAt ?? null,
    };
  } catch {
    return null;
  }
}

export function writeSessionHint(storage: Storage | null, hint: SessionHint | null): void {
  try {
    if (!storage) return;
    if (!hint) storage.removeItem(SESSION_HINT_KEY);
    else {
      const next = JSON.stringify(hint);
      // Rewriting the same value still fires `storage` in other tabs in some browsers.
      if (storage.getItem(SESSION_HINT_KEY) !== next) storage.setItem(SESSION_HINT_KEY, next);
    }
  } catch {
    /* storage disabled: the session still works, it just is not restored optimistically */
  }
}

/** True once the server says a live session may be slid forward (no new signature). */
export function shouldRefreshSession(
  info: { refreshAfter?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!info?.refreshAfter) return false;
  const at = Date.parse(info.refreshAfter);
  return Number.isFinite(at) && at <= now;
}

/** A wallet's "no" (Phantom 4001, Solflare/Backpack "User rejected", WalletConnect 5000). */
export function isUserRejection(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 4001 || code === 5000) return true;
  const text = err instanceof Error ? err.message : String(err ?? '');
  return /reject|denied|declin|cancel/i.test(text);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Single-flight: while one sign-in is running, every other caller gets the same promise,
 * so a double click (or two buttons) never opens two signature prompts.
 */
export function singleFlight<T>(): (run: () => Promise<T>) => Promise<T> {
  let current: Promise<T> | null = null;
  return (run) => {
    if (current) return current;
    const next = run().finally(() => {
      if (current === next) current = null;
    });
    current = next;
    return next;
  };
}
