import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { attachSignature, parseTransaction } from './tx.js';

/**
 * What the SDK needs from a wallet. The SDK never sees a private key unless you hand it
 * one through keypairSigner; with a wallet adapter, the wallet signs.
 */
export interface AgentSigner {
  /** Base58 public key. */
  readonly publicKey: string;
  /** ed25519 signature of raw message bytes (64 bytes). */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Signs a serialized legacy transaction and returns the signed serialized bytes. */
  signTransaction(tx: Uint8Array): Promise<Uint8Array>;
}

/**
 * Signer from a 64-byte ed25519 secret key (the format of a Solana keypair file and of
 * `Keypair.secretKey` in @solana/web3.js). Signing happens locally in this process.
 */
export function keypairSigner(secretKey: Uint8Array): AgentSigner {
  if (secretKey.length !== 64) throw new Error('secretKey must be 64 bytes');
  const publicKey = bs58.encode(secretKey.slice(32));
  return {
    publicKey,
    async signMessage(message) {
      return nacl.sign.detached(message, secretKey);
    },
    async signTransaction(tx) {
      const parsed = parseTransaction(tx);
      return attachSignature(tx, publicKey, nacl.sign.detached(parsed.message, secretKey));
    },
  };
}

/** Minimal shape of a Solana wallet adapter (or Wallet Standard wrapper). */
export type WalletAdapterLike<T> = {
  publicKey: { toBase58(): string } | null;
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
  signTransaction?(tx: T): Promise<T>;
};

/**
 * Signer backed by a browser/extension wallet adapter. Pass @solana/web3.js `Transaction`
 * (so the SDK does not bundle web3.js): `walletAdapterSigner(wallet, Transaction)`.
 */
export function walletAdapterSigner<T extends { serialize(opts?: object): Uint8Array }>(
  adapter: WalletAdapterLike<T>,
  TransactionClass: { from(bytes: Uint8Array): T },
): AgentSigner {
  const key = adapter.publicKey?.toBase58();
  if (!key) throw new Error('wallet is not connected');
  return {
    publicKey: key,
    async signMessage(message) {
      if (!adapter.signMessage) throw new Error('wallet cannot sign messages');
      return adapter.signMessage(message);
    },
    async signTransaction(tx) {
      if (!adapter.signTransaction) throw new Error('wallet cannot sign transactions');
      const signed = await adapter.signTransaction(TransactionClass.from(tx));
      return Uint8Array.from(signed.serialize({ requireAllSignatures: true }));
    },
  };
}

/** Base58 signature of the UTF-8 text, as the API expects for challenges and reviews. */
export async function signText(signer: AgentSigner, text: string): Promise<string> {
  return bs58.encode(await signer.signMessage(new TextEncoder().encode(text)));
}
