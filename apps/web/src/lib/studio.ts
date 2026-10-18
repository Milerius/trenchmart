/**
 * Verification-fee and bond payment helpers for the creator studio.
 *
 * The API settles a payment by reading the transaction from the chain. A signature that
 * was just broadcast is often not visible yet, so the API answers TX_NOT_FOUND for a
 * second or two. Submitting retries that case instead of failing the upload.
 */

export type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;
export type UnsignedTx = { txBase64: string };

type RetryOptions = { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** POST `{txSig}` to a settle endpoint, retrying while the transaction is not yet visible. */
export async function submitPayment(
  api: ApiCall,
  path: string,
  txSig: string,
  { attempts = 20, delayMs = 1500, sleep = wait }: RetryOptions = {},
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ txSig }) });
      return;
    } catch (err) {
      if (errorCode(err) !== 'TX_NOT_FOUND' || attempt >= attempts) throw err;
      await sleep(delayMs);
    }
  }
}

/**
 * Sign and send the verification fee transaction, then record it on the version.
 * Returns false when there is nothing to pay (fee waived for the tier, or 0).
 */
export async function payVerificationFee(input: {
  api: ApiCall;
  versionId: string;
  feeTx: UnsignedTx | null | undefined;
  signAndSend: (txBase64: string) => Promise<string>;
  retry?: RetryOptions;
}): Promise<boolean> {
  if (!input.feeTx) return false;
  const txSig = await input.signAndSend(input.feeTx.txBase64);
  await submitPayment(input.api, `/studio/versions/${input.versionId}/fee`, txSig, input.retry);
  return true;
}

/**
 * Sign and send a SOL supplement (an upload or a verification beyond the daily free limit),
 * then record it. Returns false when there is nothing to pay.
 */
export async function paySupplement(input: {
  api: ApiCall;
  supplementId: string;
  tx: UnsignedTx | null | undefined;
  signAndSend: (txBase64: string) => Promise<string>;
  retry?: RetryOptions;
}): Promise<boolean> {
  if (!input.tx) return false;
  const txSig = await input.signAndSend(input.tx.txBase64);
  await submitPayment(
    input.api,
    `/supplements/${input.supplementId}/submitted`,
    txSig,
    input.retry,
  );
  return true;
}

type FeeState = {
  paid: boolean;
  feeTx: UnsignedTx | null;
  supplement?: { id: string; paid: boolean; tx: UnsignedTx | null } | null;
};

/**
 * Make sure an existing version's fee (and its upload supplement, if any) is paid before
 * review starts. Asks the API for fresh transactions, since the ones issued at creation may
 * carry an expired blockhash.
 */
export async function ensureVerificationFee(input: {
  api: ApiCall;
  versionId: string;
  signAndSend: (txBase64: string) => Promise<string>;
  retry?: RetryOptions;
}): Promise<boolean> {
  const state = await input.api<FeeState>(`/studio/versions/${input.versionId}/fee-tx`, {
    method: 'POST',
  });
  let paid = false;
  if (!state.paid) paid = await payVerificationFee({ ...input, feeTx: state.feeTx });
  if (state.supplement && !state.supplement.paid) {
    paid =
      (await paySupplement({
        ...input,
        supplementId: state.supplement.id,
        tx: state.supplement.tx,
      })) || paid;
  }
  return paid;
}
