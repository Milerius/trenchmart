/**
 * The X sign-in callback lands on /studio/profile?x=<result>&reason=<reason>. This turns
 * that into what the X card shows: whether it worked, and if not, why and what to do.
 * Reasons come from the API (apps/api/src/x-oauth.ts XFailure / XStateFailure).
 */
export type XResult = { ok: boolean; title: string; detail: string };

const TRY_AGAIN = 'Try Verify with X again.';
const SITE_SIDE =
  'This is a problem with the site, not your X account. Retrying will not help until it is fixed.';

const REASONS: Record<string, string> = {
  // The callback could not be tied to the sign-in started here.
  state_missing: `The sign-in cookie did not come back with X's redirect (blocked cookies, or X opened in another browser). ${TRY_AGAIN}`,
  state_mismatch: `X returned a sign-in that was not started from this page. ${TRY_AGAIN}`,
  state_expired: `The sign-in took longer than 10 minutes and expired. ${TRY_AGAIN}`,
  no_code: `X came back without an authorization code. ${TRY_AGAIN}`,
  signed_out:
    'Your TrenchMart session ended before X sent you back. Connect your wallet, then try again.',
  // The exchange with X.
  token_rejected: `X rejected TrenchMart's app credentials (HTTP 401). ${SITE_SIDE}`,
  code_rejected: `X did not accept the sign-in code (expired or already used). ${TRY_AGAIN}`,
  token_failed: `X could not finish the sign-in (token exchange error). ${TRY_AGAIN}`,
  users_me_forbidden: `X signed you in but refused to share your account (HTTP 403 on /2/users/me: the site's X API access does not allow it). ${SITE_SIDE}`,
  users_me_failed: `X signed you in but your account could not be read. ${TRY_AGAIN}`,
  bad_account: `X returned an account TrenchMart could not read. ${TRY_AGAIN}`,
  unreachable: `X did not answer in time. ${TRY_AGAIN}`,
  unexpected: `Something went wrong on our side while talking to X. ${TRY_AGAIN}`,
};

export function xResultMessage(result: string | null, reason: string | null): XResult | null {
  if (!result) return null;
  const why = reason ? REASONS[reason] : undefined;
  switch (result) {
    case 'linked':
      return {
        ok: true,
        title: 'X account verified and linked.',
        detail: 'Buyers now see your handle as verified.',
      };
    case 'denied':
      return {
        ok: false,
        title: 'X sign-in was cancelled.',
        detail: 'Nothing changed. You can verify any time.',
      };
    case 'taken':
      return {
        ok: false,
        title: 'That X account is already linked to another wallet.',
        detail: 'Sign in with that wallet to unlink it first, or verify a different X account.',
      };
    case 'unconfigured':
      return {
        ok: false,
        title: 'X sign-in is not configured on this deployment yet.',
        detail: '',
      };
    case 'invalid':
      return {
        ok: false,
        title: 'X sign-in could not be checked.',
        detail: why ?? `The sign-in expired. ${TRY_AGAIN}`,
      };
    default:
      return { ok: false, title: 'X sign-in failed.', detail: why ?? TRY_AGAIN };
  }
}
