import { parseSecretKey, publicKeyOf } from '@trenchmart/chain';
import { EscrowError, readEscrow, type EscrowChain } from './escrow';

export { parseSecretKey, publicKeyOf };

/** readEscrow that reports a foreign account as missing. RPC failures still throw. */
export async function readEscrowSafe(chain: EscrowChain, programId: string, address: string) {
  try {
    return await readEscrow(chain, programId, address);
  } catch (err) {
    if (err instanceof EscrowError) return null;
    throw err;
  }
}
