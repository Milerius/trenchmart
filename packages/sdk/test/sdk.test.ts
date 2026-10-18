import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import {
  compileLegacyTx,
  computeBudgetIxs,
  ESCROW_BUDGET,
  escrowAddress,
  fundIx,
  initializeIx,
  memoIx,
  parseLegacyTx,
  verifyTxSignatures,
  compileUnsignedTransferMemo,
} from '@trenchmart/chain';
import {
  cleanReviewText as sharedClean,
  reviewMessage as sharedReviewMessage,
} from '@trenchmart/shared';
import {
  DEVNET,
  TrenchmartClient,
  TrenchmartError,
  UnsafeTransactionError,
  cleanReviewText,
  fromBase64,
  inspectCheckout,
  inspectVaultPayment,
  keypairSigner,
  reviewMessage,
  toBase64,
} from '../src/index.js';

const programId = DEVNET.escrowProgramId;
const blockhash = bs58.encode(new Uint8Array(32).fill(9));
const pub = () => bs58.encode(nacl.sign.keyPair().publicKey);

function checkout(buyer: string, seller: string, price = 100_000_000n, feeBps = 500, rebateBps = 0) {
  const orderId = '11111111-2222-4333-8444-555555555555';
  const args = {
    seller,
    resolver: pub(),
    buyback: pub(),
    aiVerification: pub(),
    ops: pub(),
    safety: pub(),
    price,
    feeBps,
    rebateBps,
    splitBuybackBps: 4000,
    splitAiBps: 2500,
    splitOpsBps: 2000,
    splitSafetyBps: 1500,
    expiresAt: 1_800_000_000n,
    escrowUntil: 1_800_003_600n,
  };
  const escrow = escrowAddress(orderId, programId, buyer);
  const tx = compileLegacyTx({
    feePayer: buyer,
    instructions: [
      ...computeBudgetIxs(ESCROW_BUDGET),
      initializeIx({ programId, buyer, orderId, args, version: 2 }),
      fundIx({ programId, buyer, escrow }),
      memoIx('tm:11111111', buyer),
    ],
    recentBlockhash: blockhash,
  });
  return toBase64(tx);
}

describe('signers', () => {
  it('keypairSigner signs messages and the fee-payer slot of a legacy transaction', async () => {
    const pair = nacl.sign.keyPair();
    const signer = keypairSigner(pair.secretKey);
    expect(signer.publicKey).toBe(bs58.encode(pair.publicKey));
    const sig = await signer.signMessage(new TextEncoder().encode('hi'));
    expect(nacl.sign.detached.verify(new TextEncoder().encode('hi'), sig, pair.publicKey)).toBe(true);
    const tx = fromBase64(checkout(signer.publicKey, pub()));
    const signed = await signer.signTransaction(tx);
    expect(verifyTxSignatures(parseLegacyTx(signed))).toBe(true);
    // Only the signature bytes changed.
    expect(signed.slice(65)).toEqual(tx.slice(65));
  });
});

describe('pre-sign safety checks', () => {
  const buyer = keypairSigner(nacl.sign.keyPair().secretKey).publicKey;
  const seller = pub();

  it('accepts an API-built checkout and decodes its terms', () => {
    const terms = inspectCheckout(checkout(buyer, seller), { buyer, escrowProgramId: programId, total: '105000000', seller });
    expect(terms.price).toBe(100_000_000n);
    expect(terms.total).toBe(105_000_000n);
    expect(terms.feeBps).toBe(500);
    expect(terms.escrowUntil - terms.expiresAt).toBe(3600);
  });

  it('honours tier rebates in the expected total', () => {
    const tx = checkout(buyer, seller, 1_000_000_000n, 500, 2500);
    expect(inspectCheckout(tx, { buyer, escrowProgramId: programId, total: '1037500000' }).rebateBps).toBe(2500);
  });

  it('refuses a different total, seller, fee payer or program', () => {
    const tx = checkout(buyer, seller);
    expect(() => inspectCheckout(tx, { buyer, escrowProgramId: programId, total: '1' })).toThrow(UnsafeTransactionError);
    expect(() => inspectCheckout(tx, { buyer, escrowProgramId: programId, total: '105000000', seller: pub() })).toThrow(/seller/);
    expect(() => inspectCheckout(tx, { buyer: pub(), escrowProgramId: programId, total: '105000000' })).toThrow(/signer/);
    expect(() => inspectCheckout(tx, { buyer, escrowProgramId: pub(), total: '105000000' })).toThrow(/program/);
    // An extra system transfer smuggled into a checkout is refused.
    const smuggled = toBase64(
      compileUnsignedTransferMemo({ from: buyer, to: pub(), lamports: 5n, memo: 'x', recentBlockhash: blockhash }),
    );
    expect(() => inspectCheckout(smuggled, { buyer, escrowProgramId: programId, total: '5' })).toThrow(UnsafeTransactionError);
  });

  it('checks vault payments: payer, destination and exact amount', () => {
    const payer = pub();
    const tx = toBase64(
      compileUnsignedTransferMemo({ from: payer, to: DEVNET.vaultAddress, lamports: 50_000_000n, memo: 'tm-sup:x', recentBlockhash: blockhash }),
    );
    expect(() => inspectVaultPayment(tx, { payer, vault: DEVNET.vaultAddress, lamports: '50000000' })).not.toThrow();
    expect(() => inspectVaultPayment(tx, { payer, vault: DEVNET.vaultAddress, lamports: '1' })).toThrow(/expected/);
    expect(() => inspectVaultPayment(tx, { payer, vault: pub(), lamports: '50000000' })).toThrow();
    expect(() => inspectVaultPayment(tx, { payer: pub(), vault: DEVNET.vaultAddress, lamports: '50000000' })).toThrow();
  });
});

describe('review signing parity with the API', () => {
  it('normalises text and builds the same message as @trenchmart/shared', () => {
    for (const text of ['  Works great \r\n\n\n\n on Axiom  ', 'a\u200bb\tc   d', 'plain']) {
      expect(cleanReviewText(text)).toBe(sharedClean(text));
    }
    const input = { orderId: 'o', rating: 4, semver: '1.2.3', bodySha256: 'ab' };
    expect(reviewMessage(input)).toBe(sharedReviewMessage(input));
  });
});

type Call = { method: string; path: string; body: unknown; auth: string | null };

function mockClient(respond: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } = () => ({ body: {} })) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      auth: headers.authorization ?? null,
    };
    calls.push(call);
    const out = respond(call);
    return new Response(JSON.stringify(out.body ?? {}), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json', ...(out.headers ?? {}) },
    });
  }) as typeof fetch;
  return { client: new TrenchmartClient({ baseUrl: 'https://api.test', apiKey: 'tmk_test', fetch: fetchImpl, maxRetries: 1 }), calls };
}

describe('client', () => {
  it('calls only routes documented in the shipped OpenAPI spec', async () => {
    const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const templates = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => ({
        method: method.toUpperCase(),
        re: new RegExp(`^/api/v1${path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
      })),
    );
    const { client, calls } = mockClient();
    const id = '00000000-0000-4000-8000-000000000000';
    await Promise.all([
      client.keyInfo(), client.revokeKey(), client.me(), client.config(), client.categories(),
      client.listings({ q: 'x' }), client.listing('slug'), client.versions('slug'), client.securityReport('slug'),
      client.reviews('slug'), client.creator('h'), client.quote(id), client.createOrder(id),
      client.submitOrder(id, 'sig'), client.order(id), client.orders(), client.escrow(id), client.download(id),
      client.release(id), client.reviewForm(id), client.myReviews(), client.replyToReview(id, 'thanks'),
      client.voteReview(id, true), client.upvote('slug'), client.profile(), client.updateProfile({ bio: 'x' }),
      client.uploadAvatar(new Uint8Array([1])), client.uploadBanner(new Uint8Array([1])), client.requirements(), client.linkXDev('agent'),
      client.createListing({ title: 't', summary: 's', description: 'd', category: 'userscript', priceLamports: '1' }),
      client.myListings(), client.updateListing(id, { priceLamports: '2' }), client.listingContent(id),
      client.saveContent(id, { readme: 'r' }), client.publishContent(id), client.uploadImage(id, new Uint8Array([1])),
      client.uploadQuota(id), client.startVersion(id, { semver: '1.0.0', fileName: 'a.js', fileSize: 1 }),
      client.completeVersion(id), client.versionResult(id), client.explainVersion(id, 'note'), client.overview(),
      client.payouts(), client.delist(id), client.broadcast(new Uint8Array(200)),
      client.sales({ limit: 5 }), client.subscribers(), client.creatorReviews({ unreplied: true }),
    ]);
    expect(calls.length).toBeGreaterThan(40);
    for (const call of calls) {
      const ok = templates.some((t) => t.method === call.method && t.re.test(call.path));
      expect(ok, `${call.method} ${call.path} is not in openapi.json`).toBe(true);
      expect(call.auth).toBe('Bearer tmk_test');
    }
  });

  it('maps API errors and retries a 429 once', async () => {
    let n = 0;
    const { client } = mockClient(() => {
      n += 1;
      return n === 1
        ? { status: 429, body: { error: { code: 'RATE_LIMIT', message: 'slow' } }, headers: { 'retry-after': '0' } }
        : { status: 403, body: { error: { code: 'INSUFFICIENT_SCOPE', message: 'needs trade' } } };
    });
    const err = await client.quote('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrenchmartError);
    expect((err as TrenchmartError).status).toBe(403);
    expect((err as TrenchmartError).code).toBe('INSUFFICIENT_SCOPE');
    expect(n).toBe(2);
  });

  it('refuses to sign a key challenge that does not state the requested scopes', async () => {
    const signer = keypairSigner(nacl.sign.keyPair().secretKey);
    const { client, calls } = mockClient((call) =>
      call.path.endsWith('/challenge')
        ? { body: { nonce: 'n', message: `x\n${signer.publicKey}\nKey name: bot\nScopes: read, trade, sell` } }
        : { body: { key: 'tmk_x' } },
    );
    await expect(client.createApiKey(signer, { name: 'bot', scopes: ['trade', 'read'] })).rejects.toThrow(UnsafeTransactionError);
    expect(calls.map((c) => c.path)).toEqual(['/api/v1/agent/auth/challenge']);
  });
});
