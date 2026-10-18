import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import {
  decodeEscrow,
  decodeTransfersAndMemos,
  encodeEscrowForTest,
  orderIdBytes,
  randomKeypair,
  type EscrowStatusName,
} from '@trenchmart/chain';
import { TrenchmartClient, keypairSigner, TrenchmartError } from '../../../packages/sdk/src/index';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';

/** Integration: the official SDK driving the real API (in process), buy and sell flows. */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const programId = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
const blockhash = bs58.encode(new Uint8Array(32).fill(5));
const vault = randomKeypair();
const resolver = randomKeypair();
const buckets = [randomKeypair(), randomKeypair(), randomKeypair(), randomKeypair()].map(
  (k) => k.publicKey,
);
const script = `// ==UserScript==
// @name SDK Pack
// @match https://axiom.trade/*
// @grant none
// ==/UserScript==
console.log('sdk');
`;

let sql: Sql;

async function world() {
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: vault.publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    AI_ATTEST_SECRET: 'attest-secret',
    SOL_USD_OVERRIDE: '100',
    RATE_LIMIT_PER_MIN: '10000',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:8787',
    ESCROW_PROGRAM_ID: programId,
    ESCROW_RESOLVER: resolver.publicKey,
    ESCROW_RESOLVER_SECRET: bs58.encode(resolver.secretKey),
    ESCROW_PROGRAM_VERSION: '2',
    BUCKET_WALLET_BUYBACK: buckets[0]!,
    BUCKET_WALLET_AI_VERIFICATION: buckets[1]!,
    BUCKET_WALLET_OPS: buckets[2]!,
    BUCKET_WALLET_SAFETY: buckets[3]!,
  });
  const clock = { now: new Date('2026-06-01T00:00:00.000Z') };
  const accounts = new Map<string, Uint8Array>();
  const txs = new Map<
    string,
    { memos: string[]; transfers: { source: string; destination: string; lamports: bigint }[] }
  >();
  const deps: Deps = {
    sql,
    blob: filesystemBlob(await mkdtemp(join(tmpdir(), 'tm-sdk-')), env.sessionSecret, env.apiUrl),
    env,
    now: () => clock.now,
    getTx: async (signature) => {
      const known = txs.get(signature);
      return known
        ? {
            signature,
            err: null,
            blockTime: Math.floor(clock.now.getTime() / 1000),
            confirmationStatus: 'confirmed',
            transfers: known.transfers,
            memos: known.memos,
          }
        : null;
    },
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    escrowChain: {
      async account(address) {
        const data = accounts.get(address);
        return data ? { data, owner: programId, lamports: 1n } : null;
      },
      async sendAndConfirm() {
        for (const [address, data] of accounts) {
          const account = decodeEscrow(data);
          if (account.status === 'paid')
            accounts.set(address, encodeEscrowForTest({ ...account, status: 'released' }));
        }
        return bs58.encode(nacl.randomBytes(64));
      },
    },
    // A tiny chain: a relayed checkout funds its escrow; a relayed transfer is recorded.
    sendTx: async (tx) => {
      const signature = bs58.encode(tx.slice(1, 65));
      const decoded = decodeTransfersAndMemos(tx);
      txs.set(signature, decoded);
      const memo = decoded.memos[0];
      const [order] = memo
        ? await sql<Record<string, any>[]>`select * from orders where memo = ${memo}`
        : [];
      if (order) {
        const [seller] = await sql<
          { wallet: string }[]
        >`select u.wallet from listings l join users u on u.id = l.creator_id where l.id = ${order.listing_id}`;
        const [buyer] = await sql<
          { wallet: string }[]
        >`select wallet from users where id = ${order.buyer_id}`;
        accounts.set(
          order.escrow_address,
          encodeEscrowForTest({
            buyer: buyer!.wallet,
            seller: seller!.wallet,
            resolver: resolver.publicKey,
            buyback: buckets[0]!,
            aiVerification: buckets[1]!,
            ops: buckets[2]!,
            safety: buckets[3]!,
            status: 'paid' as EscrowStatusName,
            disputedFrom: 'pending' as EscrowStatusName,
            price: order.price,
            deposit: order.total,
            feeBps: order.fee_bps,
            rebateBps: order.rebate_bps,
            splitBuybackBps: 4000,
            splitAiBps: 2500,
            splitOpsBps: 2000,
            splitSafetyBps: 1500,
            expiresAt: BigInt(Math.floor(order.expires_at.getTime() / 1000)),
            escrowUntil: BigInt(Math.floor(order.escrow_until.getTime() / 1000)),
            bump: 255,
            orderId: orderIdBytes(order.id),
          }),
        );
      }
      return signature;
    },
  };
  const app = createApp(deps);
  // Bridge the SDK's fetch to the in-process app.
  const bridge = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    return app.request(`${url.pathname}${url.search}`, init);
  }) as typeof fetch;
  const client = (apiKey?: string) =>
    new TrenchmartClient({
      baseUrl: 'http://localhost:8787',
      apiKey,
      fetch: bridge,
      vaultAddress: vault.publicKey,
      maxRetries: 0,
    });
  return { app, deps, clock, client };
}

async function restoreConfig() {
  await sql`update config set value = '5'::jsonb where key = 'upload_limit_per_creator_day'`;
  await sql`update config set value = '250000000'::jsonb where key = 'verification_fee_lamports'`;
}

describe('SDK against the API', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, disputes, licenses,
        payouts, orders, scan_checks, scans, ai_reviews, sandbox_jobs, listing_content, listing_media,
        versions, listings, bonds, token_balances, auth_nonces, reports, rate_buckets, update_periods,
        update_renewals, supplements, verifications, api_keys, agent_challenges, issued_txs,
        feature_days, feature_bookings, users
      restart identity cascade
    `;
    await restoreConfig();
  });

  afterAll(async () => {
    await restoreConfig();
    await sql?.end();
  });

  it('buyer agent: key from a signed challenge, buy, download, release, review', async () => {
    const w = await world();
    // A live listing by some creator.
    const seller = randomKeypair();
    const creatorId = randomUUID();
    const listingId = randomUUID();
    const versionId = randomUUID();
    await sql`insert into users (id, wallet, roles) values (${creatorId}, ${seller.publicKey}, ${sql.array(['creator'])}::user_role[])`;
    await sql`insert into listings (id, creator_id, slug, title, summary, description, category, price, terminals)
      values (${listingId}, ${creatorId}, 'sdk-pack', 'SDK Pack', 'Sum', 'Desc', 'userscript', ${200_000_000n}, ${sql.array(['Axiom'])})`;
    await sql`insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${versionId}, ${listingId}, '1.0.0', 'sdk.user.js', ${script.length}, 'x', 'blobs/sdk', 'live')`;
    await sql`update listings set live_version_id = ${versionId}, first_live_at = ${new Date('2026-05-01')} where id = ${listingId}`;
    await w.deps.blob.put('blobs/sdk', new TextEncoder().encode(script));

    const signer = keypairSigner(nacl.sign.keyPair().secretKey);
    const sdk = w.client();
    const key = await sdk.createApiKey(signer, {
      name: 'sdk buyer',
      scopes: ['read', 'trade', 'review', 'profile'],
    });
    expect(key.key).toMatch(/^tmk_/);
    expect((await sdk.keyInfo()).wallet).toBe(signer.publicKey);

    // A price cap below the total refuses before anything is signed.
    await expect(sdk.buy(signer, 'sdk-pack', { maxTotalLamports: 1n })).rejects.toThrow(/exceeds/);
    const bought = await sdk.buy(signer, 'sdk-pack', { intervalMs: 10 });
    expect(bought.total).toBe('210000000');
    expect((await sdk.order(bought.orderId)).status).toBe('paid');
    const file = await sdk.downloadFile(bought.orderId);
    expect(new TextDecoder().decode(file.bytes)).toContain('SDK Pack');
    const early = await sdk.release(bought.orderId).catch((e: unknown) => e);
    expect((early as TrenchmartError).code).toBe('ESCROW_WINDOW');
    w.clock.now = new Date(new Date(bought.escrowUntil).getTime() + 1000);
    expect((await sdk.waitAndRelease(bought.orderId, { pollMs: 10 })).released).toBe(true);
    const review = await sdk.review(signer, bought.orderId, {
      rating: 5,
      body: 'Installed by my agent through the SDK; the overlay works as the listing says.',
      terminal: 'Axiom',
    });
    expect(review.ok).toBe(true);
    // Upvote (the body carries up: true; false removes it) and the buyer's own profile.
    const up = await sdk.upvote('sdk-pack');
    expect(up).toMatchObject({ count: 1, viewer: { upvoted: true } });
    expect((await sdk.listing('sdk-pack')).upvotes).toBe(1);
    expect(await sdk.upvote('sdk-pack', false)).toMatchObject({
      count: 0,
      viewer: { upvoted: false },
    });
    expect((await sdk.upvote('sdk-pack')).count).toBe(1);
    expect((await sdk.upvotes('sdk-pack')).count).toBe(1);
    await sdk.updateProfile({ displayName: 'Buyer Agent', bio: 'Buys through the SDK.' });
    expect(await sdk.profile()).toMatchObject({
      displayName: 'Buyer Agent',
      bio: 'Buys through the SDK.',
    });
    expect(await sdk.creator(signer.publicKey)).toMatchObject({ displayName: 'Buyer Agent' });
    // The creator replies with its own key.
    const creatorSdk = w.client();
    const creatorSigner = keypairSigner(seller.secretKey);
    await creatorSdk.createApiKey(creatorSigner, {
      name: 'creator',
      scopes: ['read', 'sell', 'review'],
    });
    // A creator cannot upvote its own listing.
    await expect(creatorSdk.upvote('sdk-pack')).rejects.toThrow(/OWN_LISTING/);
    const open = await creatorSdk.creatorReviews({ unreplied: true });
    expect(open.reviews.map((r) => r.id)).toContain(review.id);
    expect((await creatorSdk.replyToReview(review.id, 'Thanks for buying!')).ok).toBe(true);
    expect(
      (await creatorSdk.creatorReviews({ unreplied: true })).reviews.map((r) => r.id),
    ).not.toContain(review.id);
    const all = await creatorSdk.creatorReviews();
    expect(all.reviews.find((r) => r.id === review.id)).toMatchObject({
      rating: 5,
      reply: 'Thanks for buying!',
    });
    // Sales and subscribers carry the purchase (free update period or lifetime updates).
    const sales = await creatorSdk.sales({ limit: 10 });
    expect(sales.sales.find((sale) => sale.id === bought.orderId)).toMatchObject({
      status: 'released',
      buyer: signer.publicKey,
    });
    const subs = await creatorSdk.subscribers();
    const sub = subs.subscribers.find((entry) => entry.orderId === bought.orderId);
    expect(['free', 'forever']).toContain(sub?.status);
    expect(subs.counts.free + subs.counts.forever).toBeGreaterThanOrEqual(1);
    // Creator data needs the sell scope: the buyer's key is refused.
    await expect(sdk.sales()).rejects.toThrow(/INSUFFICIENT_SCOPE/);
    await sdk.revokeKey();
    await expect(sdk.me()).rejects.toThrow(/INVALID_API_KEY/);
  });

  it('seller agent: profile, listing with specs, supplement + fee paid by signed tx, scan verdict, price, sales', async () => {
    const w = await world();
    const signer = keypairSigner(nacl.sign.keyPair().secretKey);
    const sdk = w.client();
    await sdk.createApiKey(signer, {
      name: 'sdk seller',
      scopes: ['read', 'sell', 'profile', 'review'],
    });
    await sdk.updateProfile({
      displayName: 'Seller Agent',
      bio: 'Autonomous seller.',
      socials: { website: 'example.com' },
    });
    await sdk.request('POST', '/studio/x', { body: { handle: 'sdk_seller' } });
    const [user] = await sql<
      { id: string }[]
    >`select id from users where wallet = ${signer.publicKey}`;
    await sql`insert into bonds (user_id, amount, tx_sig, status) values (${user!.id}, ${1_000_000_000n}, ${bs58.encode(nacl.randomBytes(64))}, 'active')`;

    const created = await sdk
      .createListing({
        title: 'SDK Wallet List',
        summary: 'Smart money wallets.',
        description: 'A labelled list.',
        category: 'wallet_list',
        terminals: ['Axiom'],
        priceLamports: '300000000',
        kind: 'wallet',
        specs: {
          chain: 'solana',
          formats: ['csv'],
          cadence: 'weekly',
          columns: [],
        },
      })
      .catch(async (err: unknown) => {
        // wallet_list needs a 2 SOL bond: top it up, then retry.
        expect((err as TrenchmartError).code).toBe('BOND_REQUIRED');
        await sql`update bonds set amount = ${2_000_000_000n} where user_id = ${user!.id}`;
        return sdk.createListing({
          title: 'SDK Wallet List',
          summary: 'Smart money wallets.',
          description: 'A labelled list.',
          category: 'wallet_list',
          terminals: ['Axiom'],
          priceLamports: '300000000',
          kind: 'wallet',
          specs: {
            chain: 'solana',
            formats: ['csv'],
            cadence: 'weekly',
            columns: [],
          },
        });
      });
    expect(created.id).toBeTruthy();

    // Daily upload limit used up: the version needs a supplement, plus the verification fee.
    await sql`update config set value = '0'::jsonb where key = 'upload_limit_per_creator_day'`;
    const csv = new TextEncoder().encode(
      'wallet,label\n5T68NkSrw951yTAkZpBS24ZsBdqvNmY52bLdGWo9EGxB,smart\n',
    );
    await expect(
      sdk.publishVersion(signer, created.id, {
        semver: '1.0.0',
        fileName: 'wallets.csv',
        bytes: csv,
      }),
    ).rejects.toThrow(/SUPPLEMENT_REQUIRED/);
    const result = await sdk.publishVersion(
      signer,
      created.id,
      { semver: '1.0.0', changelog: 'first list', fileName: 'wallets.csv', bytes: csv },
      { acceptSupplement: true, intervalMs: 10, pollMs: 10 },
    );
    expect(result.version.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.checks.length).toBeGreaterThan(0);
    const [supplement] = await sql<
      { status: string }[]
    >`select status from supplements where user_id = ${user!.id}`;
    expect(['paid', 'used']).toContain(supplement!.status);
    const [version] = await sql<
      { vfee_sig: string | null }[]
    >`select vfee_sig from versions where id = ${result.version.id}`;
    expect(version!.vfee_sig).toBeTruthy();

    await sdk.updateListing(created.id, { priceLamports: '350000000' });
    const quota = await sdk.uploadQuota(created.id);
    expect((quota.listing as { price: string }).price).toBe('350000000');
    // Featured spot: quote, then book + sign + relay + confirm the SOL payment.
    // The in-process scan has no AI reviewer; mark the version live as a passing scan would.
    await sql`update versions set status = 'live' where id = ${result.version.id}`;
    await sql`update listings set live_version_id = ${result.version.id} where id = ${created.id}`;
    const feature = {
      listingId: created.id,
      kind: 'home' as const,
      startDay: '2026-06-01',
      days: 1,
    };
    const fq = (await sdk.featuringQuote(feature)) as { problems: unknown[] };
    expect(fq.problems).toEqual([]);
    const booked = await sdk.featureListing(signer, feature, { intervalMs: 10 });
    expect(booked.signature).toBeTruthy();
    const [booking] = await sql<
      { status: string; tx_sig: string }[]
    >`select status, tx_sig from feature_bookings where id = ${booked.bookingId}`;
    expect(booking).toMatchObject({ status: 'paid', tx_sig: booked.signature });
    expect(await sdk.overview()).toBeTruthy();
    expect(await sdk.payouts()).toBeTruthy();
    expect((await sdk.profile()).displayName ?? (await sdk.profile())).toBeTruthy();
  });
});
