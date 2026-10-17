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
