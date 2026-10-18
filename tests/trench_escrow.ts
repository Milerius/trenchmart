import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnchorProvider, Program, setProvider, type Idl } from '@anchor-lang/core';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';

const idl = JSON.parse(
  readFileSync(new URL('../target/idl/trench_escrow.json', import.meta.url), 'utf8'),
) as Idl;
const provider = AnchorProvider.env();
setProvider(provider);
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

// v2 seeds: ["escrow", buyer, order_id] (L-02).
function pda(id: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), provider.wallet.publicKey.toBuffer(), Buffer.from(id)],
    programId,
  )[0];
}

const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
const programData = PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER)[0];
// One program-wide resolver (M-02): every escrow's disputes are settled by config.resolver.
const resolver = Keypair.generate();

async function sleepUntil(unix: number) {
  while (Math.floor(Date.now() / 1000) <= unix) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function args(group: Parties, expiresAt: number, escrowUntil: number) {
  return {
    seller: group.seller.publicKey,
    resolver: resolver.publicKey,
    buyback: group.buyback.publicKey,
    aiVerification: group.ai.publicKey,
    ops: group.ops.publicKey,
    safety: group.safety.publicKey,
    price: new BN(1_500_000_000),
    feeBps: 500,
    rebateBps: 6_000,
    splitBuybackBps: 4_000,
    splitAiBps: 2_500,
    splitOpsBps: 2_000,
    splitSafetyBps: 1_500,
    expiresAt: new BN(expiresAt),
    escrowUntil: new BN(escrowUntil),
  };
}

function releaseAccounts(escrow: PublicKey, group: Parties) {
  return {
    escrow,
    seller: group.seller.publicKey,
    buyback: group.buyback.publicKey,
    aiVerification: group.ai.publicKey,
    ops: group.ops.publicKey,
    safety: group.safety.publicKey,
  };
}

async function initialize(id: number[], group: Parties, expiresAt: number, escrowUntil: number) {
  const escrow = pda(id);
  await program.methods
    .initialize(id, args(group, expiresAt, escrowUntil))
    .accounts({
      buyer: provider.wallet.publicKey,
      escrow,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return escrow;
}

function statusName(status: unknown): string {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object') return Object.keys(status)[0] ?? '';
  return String(status);
}

async function expectFail(run: () => Promise<unknown>, code: string) {
  try {
    await run();
  } catch (err) {
    const extra = err as { code?: unknown; msg?: unknown; logs?: unknown };
    const text =
      (err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)) +
      `\n${String(extra.code ?? '')} ${String(extra.msg ?? '')} ${JSON.stringify(extra.logs ?? [])}`;
    assert.match(text, new RegExp(code, 'i'), text);
    return;
  }
  assert.fail(`expected ${code}`);
}

const now = () => Math.floor(Date.now() / 1000);
const future = now() + 3_600;

const airdrop = await provider.connection.requestAirdrop(
  provider.wallet.publicKey,
  20 * LAMPORTS_PER_SOL,
);
await provider.connection.confirmTransaction(airdrop, 'confirmed');

// The test validator deploys upgradeable (Anchor.toml [test] upgradeable = true), so the
// provider wallet is the upgrade authority and may create the config.
await expectFail(
  () =>
    program.methods
      .initConfig(resolver.publicKey, new BN(3_600))
      .accounts({
        authority: resolver.publicKey,
        programData,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([resolver])
      .rpc(),
  'ConfigAuthority|insufficient|0x1',
);
const configSig = await program.methods
  .initConfig(resolver.publicKey, new BN(3_600))
  .accounts({
    authority: provider.wallet.publicKey,
    programData,
    config: configPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
const config = await program.account.config.fetch(configPda);
assert.equal(config.resolver.toBase58(), resolver.publicKey.toBase58());
await expectFail(() => initialize(orderId(), parties(), future, future - 1), 'BadTerms');

const releaseGroup = parties();
const releaseId = orderId();
const releaseUntil = now() + 8;
const releaseEscrow = await initialize(releaseId, releaseGroup, releaseUntil, releaseUntil);
assert.equal(statusName((await program.account.escrow.fetch(releaseEscrow)).status), 'pending');

await expectFail(
  () => program.methods.release().accounts(releaseAccounts(releaseEscrow, releaseGroup)).rpc(),
  'IllegalTransition',
);
await expectFail(
  () => program.methods.expire().accounts({ escrow: releaseEscrow }).rpc(),
  'TooEarly',
);
await expectFail(
  () => program.methods.release().accounts(releaseAccounts(releaseEscrow, releaseGroup)).rpc(),
  'IllegalTransition',
);

const before = await provider.connection.getBalance(releaseEscrow);
await program.methods
  .fund()
  .accounts({
    buyer: provider.wallet.publicKey,
    escrow: releaseEscrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
const funded = await program.account.escrow.fetch(releaseEscrow);
assert.equal(statusName(funded.status), 'paid');
assert.equal(new BN(funded.deposit).toString(), '1530000000');
assert.equal((await provider.connection.getBalance(releaseEscrow)) - before, 1_530_000_000);

await expectFail(
  () =>
    program.methods
      .fund()
      .accounts({
        buyer: provider.wallet.publicKey,
        escrow: releaseEscrow,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  'IllegalTransition',
);
await sleepUntil(releaseUntil + 1);
await expectFail(
  () =>
    program.methods
      .openDispute()
      .accounts({ signer: provider.wallet.publicKey, config: configPda, escrow: releaseEscrow })
      .rpc(),
  'WindowClosed',
);

const sellerBefore = await provider.connection.getBalance(releaseGroup.seller.publicKey);
const releaseSig = await program.methods
  .release()
  .accounts(releaseAccounts(releaseEscrow, releaseGroup))
  .rpc();
const released = await program.account.escrow.fetch(releaseEscrow);
assert.equal(statusName(released.status), 'released');
assert.equal(
  (await provider.connection.getBalance(releaseGroup.seller.publicKey)) - sellerBefore,
  1_500_000_000,
);
assert.equal(await provider.connection.getBalance(releaseGroup.buyback.publicKey), 12_000_000);
assert.equal(await provider.connection.getBalance(releaseGroup.ai.publicKey), 7_500_000);
assert.equal(await provider.connection.getBalance(releaseGroup.ops.publicKey), 6_000_000);
assert.equal(await provider.connection.getBalance(releaseGroup.safety.publicKey), 4_500_000);

const disputeSig = await program.methods
  .openDispute()
  .accounts({ signer: provider.wallet.publicKey, config: configPda, escrow: releaseEscrow })
  .rpc();
assert.equal(statusName((await program.account.escrow.fetch(releaseEscrow)).status), 'disputed');
await expectFail(
  () =>
    program.methods
      .refund()
      .accounts({
        resolver: resolver.publicKey,
        config: configPda,
        escrow: releaseEscrow,
        buyer: provider.wallet.publicKey,
      })
      .signers([resolver])
      .rpc(),
  'FundsAlreadyReleased',
);
const rejectSig = await program.methods
  .rejectDispute()
  .accounts({ resolver: resolver.publicKey, config: configPda, escrow: releaseEscrow })
  .signers([resolver])
  .rpc();
assert.equal(statusName((await program.account.escrow.fetch(releaseEscrow)).status), 'released');

const refundGroup = parties();
const refundEscrow = await initialize(orderId(), refundGroup, future, future);
await program.methods
  .fund()
  .accounts({
    buyer: provider.wallet.publicKey,
    escrow: refundEscrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
await expectFail(
  () => program.methods.release().accounts(releaseAccounts(refundEscrow, refundGroup)).rpc(),
  'TooEarly',
);
await expectFail(
  () =>
    program.methods
      .refund()
      .accounts({
        resolver: resolver.publicKey,
        config: configPda,
        escrow: refundEscrow,
        buyer: provider.wallet.publicKey,
      })
      .signers([resolver])
      .rpc(),
  'IllegalTransition',
);
const buyerBefore = await provider.connection.getBalance(provider.wallet.publicKey);
await program.methods
  .openDispute()
  .accounts({ signer: provider.wallet.publicKey, config: configPda, escrow: refundEscrow })
  .rpc();
const refundSig = await program.methods
  .refund()
  .accounts({
    resolver: resolver.publicKey,
    config: configPda,
    escrow: refundEscrow,
    buyer: provider.wallet.publicKey,
  })
  .signers([resolver])
  .rpc();
const refunded = await program.account.escrow.fetch(refundEscrow);
assert.equal(statusName(refunded.status), 'refunded');
assert.equal(new BN(refunded.deposit).toString(), '0');
assert.ok(
  (await provider.connection.getBalance(provider.wallet.publicKey)) - buyerBefore > 1_500_000_000,
);

const expireGroup = parties();
const expireAt = now() + 3;
const expireEscrow = await initialize(orderId(), expireGroup, expireAt, future);
await sleepUntil(expireAt + 1);
await expectFail(
  () =>
    program.methods
      .fund()
      .accounts({
        buyer: provider.wallet.publicKey,
        escrow: expireEscrow,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  'Expired',
);
const expireSig = await program.methods.expire().accounts({ escrow: expireEscrow }).rpc();
assert.equal(statusName((await program.account.escrow.fetch(expireEscrow)).status), 'expired');

await expectFail(
  () => program.methods.expire().accounts({ escrow: expireEscrow }).rpc(),
  'IllegalTransition',
);
// L-01: a terminal escrow closes and its rent returns to the buyer.
const closeSig = await program.methods
  .close()
  .accounts({ escrow: expireEscrow, buyer: provider.wallet.publicKey })
  .rpc();
assert.equal(await provider.connection.getAccountInfo(expireEscrow), null);

// Release is permissionless after the window, so a Disputed escrow must never release:
// only the resolver can move it (refund or reject_dispute). Here the resolver freezes it
// on chain without the buyer's signature (M-01).
const frozenGroup = parties();
const frozenUntil = now() + 6;
const frozenEscrow = await initialize(orderId(), frozenGroup, frozenUntil, frozenUntil);
await program.methods
  .fund()
  .accounts({
    buyer: provider.wallet.publicKey,
    escrow: frozenEscrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
await program.methods
  .openDispute()
  .accounts({ signer: resolver.publicKey, config: configPda, escrow: frozenEscrow })
  .signers([resolver])
  .rpc();
while (Math.floor(Date.now() / 1000) <= frozenUntil + 2) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
await expectFail(
  () => program.methods.release().accounts(releaseAccounts(frozenEscrow, frozenGroup)).rpc(),
  'IllegalTransition',
);
assert.equal(statusName((await program.account.escrow.fetch(frozenEscrow)).status), 'disputed');

const stranger = Keypair.generate();
await expectFail(
  () =>
    program.methods
      .rejectDispute()
      .accounts({ resolver: stranger.publicKey, config: configPda, escrow: releaseEscrow })
      .signers([stranger])
      .rpc(),
  'ConstraintHasOne|has one',
);

console.log(
  JSON.stringify({
    programId: programId.toBase58(),
    releaseSig,
    disputeSig,
    rejectSig,
    refundSig,
    expireSig,
    configSig,
    closeSig,
  }),
);
