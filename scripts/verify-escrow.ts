/**
 * Deploy is separate (`anchor deploy` on devnet). This script sends the
 * fund, release, dispute, refund, and expire transactions and writes
 * docs/ESCROW_TESTNET_EVIDENCE.md. It refuses any mainnet URL.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { AnchorProvider, Program, Wallet, setProvider, type Idl } from '@anchor-lang/core';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';

const PRICE = 10_000_000;
const FEE_BPS = 500;
const REBATE_BPS = 6_000;
const SPLIT = [4_000, 2_500, 2_000, 1_500] as const;
const TOTAL = 10_200_000;
const SELLER_PAYOUT = PRICE;
const BUYBACK = 80_000;
const AI = 50_000;
const OPS = 40_000;
const SAFETY = 30_000;

const url = process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com';
assertSafeRpc(url);
const walletPath = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, 'utf8'))));
const connection = new Connection(url, 'confirmed');
const provider = new AnchorProvider(connection, new Wallet(payer), {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
setProvider(provider);

const idl = JSON.parse(
  readFileSync(new URL('../target/idl/trench_escrow.json', import.meta.url), 'utf8'),
) as Idl;
const program = new Program(idl, provider);
const programId = new PublicKey(idl.address);

type Parties = {
  seller: Keypair;
  resolver: Keypair;
  buyback: Keypair;
  ai: Keypair;
  ops: Keypair;
  safety: Keypair;
};

function assertSafeRpc(rpc: string) {
  const lower = rpc.toLowerCase();
  if (lower.includes('mainnet') || lower.includes('mainnet-beta')) {
    throw new Error(`refusing mainnet RPC: ${rpc}`);
  }
  if (!lower.includes('devnet')) {
    throw new Error(`escrow evidence runs on devnet only, got ${rpc}`);
  }
}

function parties(): Parties {
  return {
    seller: Keypair.generate(),
    resolver: Keypair.generate(),
    buyback: Keypair.generate(),
    ai: Keypair.generate(),
    ops: Keypair.generate(),
    safety: Keypair.generate(),
  };
}

function orderId(): number[] {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)));
}

function pda(id: number[]): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow'), Buffer.from(id)], programId)[0];
}

function statusName(status: unknown): string {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object') return Object.keys(status)[0] ?? '';
  return String(status);
}

function args(group: Parties, expiresAt: number, escrowUntil: number) {
  return {
    seller: group.seller.publicKey,
    resolver: group.resolver.publicKey,
    buyback: group.buyback.publicKey,
    aiVerification: group.ai.publicKey,
    ops: group.ops.publicKey,
    safety: group.safety.publicKey,
    price: new BN(PRICE),
    feeBps: FEE_BPS,
    rebateBps: REBATE_BPS,
    splitBuybackBps: SPLIT[0],
    splitAiBps: SPLIT[1],
    splitOpsBps: SPLIT[2],
    splitSafetyBps: SPLIT[3],
    expiresAt: new BN(expiresAt),
    escrowUntil: new BN(escrowUntil),
  };
}

async function ensureRent(pubkey: PublicKey, rent: number) {
  const balance = await connection.getBalance(pubkey);
  if (balance >= rent) return;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: pubkey,
      lamports: rent,
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [payer]);
}

async function initialize(id: number[], group: Parties, expiresAt: number, escrowUntil: number) {
  const escrow = pda(id);
  const signature = await program.methods
    .initialize(id, args(group, expiresAt, escrowUntil))
    .accounts({
      buyer: payer.publicKey,
      escrow,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return { escrow, signature };
}

const info = await connection.getAccountInfo(programId);
if (!info?.executable) {
  throw new Error(`${programId.toBase58()} is not an executable program on ${url}`);
}

const balance = await connection.getBalance(payer.publicKey);
if (balance < 0.05 * LAMPORTS_PER_SOL) {
  const airdrop = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdrop, 'confirmed');
}

const rent = await connection.getMinimumBalanceForRentExemption(0);
const now = Math.floor(Date.now() / 1000);
const future = now + 3_600;
const past = now - 120;

const releaseGroup = parties();
for (const key of [
  releaseGroup.seller,
  releaseGroup.buyback,
  releaseGroup.ai,
  releaseGroup.ops,
  releaseGroup.safety,
]) {
  await ensureRent(key.publicKey, rent);
}
const releaseId = orderId();
const releaseInit = await initialize(releaseId, releaseGroup, future, past);
const fundSig = await program.methods
  .fund()
  .accounts({
    buyer: payer.publicKey,
    escrow: releaseInit.escrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
const funded = await program.account.escrow.fetch(releaseInit.escrow);
assert.equal(statusName(funded.status), 'paid');
assert.equal(new BN(funded.deposit).toString(), String(TOTAL));

const sellerBefore = await connection.getBalance(releaseGroup.seller.publicKey);
const releaseSig = await program.methods
  .release()
  .accounts({
    escrow: releaseInit.escrow,
    seller: releaseGroup.seller.publicKey,
    buyback: releaseGroup.buyback.publicKey,
    aiVerification: releaseGroup.ai.publicKey,
    ops: releaseGroup.ops.publicKey,
    safety: releaseGroup.safety.publicKey,
  })
  .rpc();
assert.equal(
  statusName((await program.account.escrow.fetch(releaseInit.escrow)).status),
  'released',
);
assert.equal(
  (await connection.getBalance(releaseGroup.seller.publicKey)) - sellerBefore,
  SELLER_PAYOUT,
);
assert.equal((await connection.getBalance(releaseGroup.buyback.publicKey)) - rent, BUYBACK);
assert.equal((await connection.getBalance(releaseGroup.ai.publicKey)) - rent, AI);
assert.equal((await connection.getBalance(releaseGroup.ops.publicKey)) - rent, OPS);
assert.equal((await connection.getBalance(releaseGroup.safety.publicKey)) - rent, SAFETY);

const disputeSig = await program.methods
  .openDispute()
  .accounts({ buyer: payer.publicKey, escrow: releaseInit.escrow })
  .rpc();
const rejectSig = await program.methods
  .rejectDispute()
  .accounts({ resolver: releaseGroup.resolver.publicKey, escrow: releaseInit.escrow })
  .signers([releaseGroup.resolver])
  .rpc();
assert.equal(
  statusName((await program.account.escrow.fetch(releaseInit.escrow)).status),
  'released',
);

const refundGroup = parties();
const refundInit = await initialize(orderId(), refundGroup, future, future);
const refundFundSig = await program.methods
  .fund()
  .accounts({
    buyer: payer.publicKey,
    escrow: refundInit.escrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
const buyerBefore = await connection.getBalance(payer.publicKey);
const refundDisputeSig = await program.methods
  .openDispute()
  .accounts({ buyer: payer.publicKey, escrow: refundInit.escrow })
  .rpc();
const refundSig = await program.methods
  .refund()
  .accounts({
    resolver: refundGroup.resolver.publicKey,
    escrow: refundInit.escrow,
    buyer: payer.publicKey,
  })
  .signers([refundGroup.resolver])
  .rpc();
const refunded = await program.account.escrow.fetch(refundInit.escrow);
assert.equal(statusName(refunded.status), 'refunded');
assert.equal(new BN(refunded.deposit).toString(), '0');
assert.ok((await connection.getBalance(payer.publicKey)) - buyerBefore > SELLER_PAYOUT);

const expireGroup = parties();
const expireInit = await initialize(orderId(), expireGroup, past, future);
const expireSig = await program.methods.expire().accounts({ escrow: expireInit.escrow }).rpc();
assert.equal(statusName((await program.account.escrow.fetch(expireInit.escrow)).status), 'expired');

const txs = [
  ['release initialize', releaseInit.signature],
  ['release fund', fundSig],
  ['release', releaseSig],
  ['open dispute after release', disputeSig],
  ['reject dispute', rejectSig],
  ['refund initialize', refundInit.signature],
  ['refund fund', refundFundSig],
  ['open dispute from paid', refundDisputeSig],
  ['refund', refundSig],
  ['expire initialize', expireInit.signature],
  ['expire', expireSig],
] as const;

const lines = txs.map(([name, signature]) => {
  const href = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  return `| ${name} | [\`${signature}\`](${href}) |`;
});

const programHref = `https://explorer.solana.com/address/${programId.toBase58()}?cluster=devnet`;
const markdown = `# Escrow devnet evidence

Cluster: devnet. RPC: \`${url}\`. Mainnet was not used.

Program [\`${programId.toBase58()}\`](${programHref}).

The payer is a throwaway devnet keypair generated for this verification. The secret is not in the repo.

Price ${PRICE} lamports, fee ${FEE_BPS} bps, Trencher rebate ${REBATE_BPS} bps. The buyer locked ${TOTAL} lamports. Release paid the seller ${SELLER_PAYOUT} and split the net fee into buyback ${BUYBACK}, ai_verification ${AI}, ops ${OPS}, and safety ${SAFETY}. A second order was disputed from \`paid\` and refunded. A third order expired before it was funded.

| Step | Transaction |
| --- | --- |
${lines.join('\n')}
`;

writeFileSync(new URL('../docs/ESCROW_TESTNET_EVIDENCE.md', import.meta.url), markdown);
console.log(markdown);
