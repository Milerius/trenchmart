import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import {
  compileLegacyTx,
  decodeEscrow,
  encodeEscrowForTest,
  escrowAddress,
  fundIx,
  initializeIx,
  memoIx,
  orderIdBytes,
  parseSecretKey,
  publicKeyOf,
  refundIx,
  releaseIx,
  signTx,
  type EscrowAccount,
} from './escrow';
import { rpc, RpcError } from './rpc';

const programId = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
const orderId = '3f2a7c1e-9b4d-4e8a-8c2f-1a2b3c4d5e6f';
const pk = () => Keypair.generate().publicKey.toBase58();

describe('escrow PDA and encoding', () => {
  it('derives the same PDA as web3.js', () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(orderIdBytes(orderId))],
      new PublicKey(programId),
    );
    expect(escrowAddress(orderId, programId)).toBe(expected.toBase58());
  });

  it('rejects a non-uuid order id', () => {
    expect(() => orderIdBytes('nope')).toThrow(/uuid/);
  });

  it('compiles the same message bytes as web3.js and signs every signer slot', () => {
    const buyer = Keypair.generate();
    const args = {
      seller: pk(),
      resolver: pk(),
      buyback: pk(),
      aiVerification: pk(),
      ops: pk(),
      safety: pk(),
      price: 100_000_000n,
      feeBps: 500,
      rebateBps: 0,
      splitBuybackBps: 4000,
      splitAiBps: 2500,
      splitOpsBps: 2000,
      splitSafetyBps: 1500,
      expiresAt: 1_800_000_000n,
      escrowUntil: 1_800_172_800n,
    };
    const buyerKey = buyer.publicKey.toBase58();
    const escrow = escrowAddress(orderId, programId);
    const ixs = [
      initializeIx({ programId, buyer: buyerKey, orderId, args }),
      fundIx({ programId, buyer: buyerKey, escrow }),
      memoIx('tm:3f2a7c1e', buyerKey),
    ];
    const blockhash = bs58.encode(new Uint8Array(32).fill(7));
    const ours = compileLegacyTx({
      feePayer: buyerKey,
      instructions: ixs,
      recentBlockhash: blockhash,
    });
    const theirs = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: blockhash });
    for (const ix of ixs) {
      theirs.add(
        new TransactionInstruction({
          programId: new PublicKey(ix.programId),
          keys: ix.keys.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })),
          data: Buffer.from(ix.data),
        }),
      );
    }
    const decoded = Transaction.from(Buffer.from(ours));
    expect(Buffer.from(decoded.serializeMessage())).toEqual(theirs.serializeMessage());
    const signed = signTx(ours, [buyer.secretKey]);
    const parsed = Transaction.from(Buffer.from(signed));
    expect(parsed.verifySignatures()).toBe(true);
    // initialize data: 8 discriminator + 16 order id + 6*32 keys + 8 + 6*2 + 8 + 8
    expect(ixs[0]!.data.length).toBe(8 + 16 + 192 + 8 + 12 + 16);
  });

  it('puts the fee payer first and keeps a second signer (resolver refund + crank)', () => {
    const crank = Keypair.generate();
    const resolver = Keypair.generate();
    const escrow = escrowAddress(orderId, programId);
    const tx = compileLegacyTx({
      feePayer: crank.publicKey.toBase58(),
      instructions: [
        refundIx({ programId, resolver: resolver.publicKey.toBase58(), escrow, buyer: pk() }),
      ],
      recentBlockhash: bs58.encode(new Uint8Array(32).fill(1)),
    });
    const signed = signTx(tx, [crank.secretKey, resolver.secretKey]);
    const parsed = Transaction.from(Buffer.from(signed));
    expect(parsed.feePayer?.toBase58()).toBe(crank.publicKey.toBase58());
    expect(parsed.signatures).toHaveLength(2);
    expect(parsed.verifySignatures()).toBe(true);
    expect(
      releaseIx({
        programId,
        escrow,
        seller: pk(),
        buyback: pk(),
        aiVerification: pk(),
        ops: pk(),
        safety: pk(),
      }).keys.every((k) => k.isWritable && !k.isSigner),
    ).toBe(true);
  });

  it('round-trips the Escrow account layout and refuses other accounts', () => {
    const account: EscrowAccount = {
      buyer: pk(),
      seller: pk(),
      resolver: pk(),
      buyback: pk(),
      aiVerification: pk(),
      ops: pk(),
      safety: pk(),
      status: 'paid',
      disputedFrom: 'pending',
      price: 100_000_000n,
      deposit: 105_000_000n,
      feeBps: 500,
      rebateBps: 0,
      splitBuybackBps: 4000,
      splitAiBps: 2500,
      splitOpsBps: 2000,
      splitSafetyBps: 1500,
      expiresAt: 10n,
      escrowUntil: 20n,
      bump: 254,
      orderId: orderIdBytes(orderId),
    };
    expect(decodeEscrow(encodeEscrowForTest(account))).toEqual(account);
    const wrong = encodeEscrowForTest(account);
    wrong[0] = wrong[0]! ^ 1;
    expect(() => decodeEscrow(wrong)).toThrow(/not an Escrow/);
    expect(() => decodeEscrow(new Uint8Array(10))).toThrow(/truncated/);
  });

  it('parses a keygen secret and refuses a mismatched one', () => {
    const pair = Keypair.generate();
    const secret = parseSecretKey(JSON.stringify(Array.from(pair.secretKey)));
    expect(publicKeyOf(secret)).toBe(pair.publicKey.toBase58());
    expect(parseSecretKey(bs58.encode(pair.secretKey))).toEqual(secret);
    const broken = new Uint8Array(pair.secretKey);
    broken[40] = broken[40]! ^ 1;
    expect(() => parseSecretKey(JSON.stringify(Array.from(broken)))).toThrow(/match/);
  });
});

describe('rpc retry', () => {
  const ok = () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 42 }));
  it('backs off on 429 and on the provider rate-limit code, then succeeds', async () => {
    const replies = [
      new Response('', { status: 429 }),
      new Response(JSON.stringify({ error: { code: -32029, message: 'Too Many Requests' } })),
      ok(),
    ];
    const waits: number[] = [];
    const result = await rpc('https://rpc.example/devnet?api-key=secret', 'getSlot', [], {
      fetchImpl: async () => replies.shift()!,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(result).toBe(42);
    expect(waits).toHaveLength(2);
  });

  it('does not retry a 403 block and never leaks the api key', async () => {
    let calls = 0;
    const err = await rpc('https://rpc.example/devnet?api-key=secret', 'getSlot', [], {
      fetchImpl: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ error: { code: 403, message: 'Your IP or provider is blocked' } }),
          { status: 403 },
        );
      },
      sleep: async () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(calls).toBe(1);
    expect(String((err as Error).message)).toContain('blocked');
    expect(String((err as Error).message)).not.toContain('secret');
  });

  it('refuses a mainnet url before any request', async () => {
    await expect(rpc('https://api.mainnet-beta.solana.com', 'getSlot', [])).rejects.toThrow(
      /mainnet/i,
    );
  });
});
