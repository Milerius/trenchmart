import { DEVNET, type Scope } from './constants.js';
import { TrenchmartError, UnsafeTransactionError } from './errors.js';
import { signText, type AgentSigner } from './signer.js';
import {
  fromBase64,
  inspectCheckout,
  inspectVaultPayment,
  parseTransaction,
  toBase64,
} from './tx.js';
import { COMPUTE_BUDGET_PROGRAM } from './constants.js';
import type {
  ApiKeyInfo,
  CheckoutOrder,
  CreateListingInput,
  CreatedApiKey,
  CreatorReview,
  Download,
  Json,
  ListingDetail,
  ListingPatch,
  ListingSummary,
  ListingsQuery,
  Order,
  Page,
  ProfileInput,
  PublicConfig,
  Quote,
  ReviewForm,
  Sale,
  StartedVersion,
  Subscriber,
  UnsignedPayment,
  VersionResult,
} from './types.js';

export type ClientOptions = {
  /** API origin. Default: the live devnet API, https://api.trenchmart.fun. */
  baseUrl?: string;
  /** A tmk_ API key. Optional for public reads and key creation. */
  apiKey?: string;
  /** Custom fetch (tests, proxies). Default: global fetch. */
  fetch?: typeof fetch;
  /** Retries on 429 (honouring Retry-After) and 502/503. Default 2. */
  maxRetries?: number;
  /** Escrow program the SDK accepts in checkout transactions. Default: devnet program. */
  escrowProgramId?: string;
  /** Vault the SDK accepts in fee/supplement/bond payments. Default: devnet vault. */
  vaultAddress?: string;
  /** Your own RPC, used when a flow is called with broadcast: 'rpc'. */
  rpcUrl?: string;
};

export type BroadcastMode = 'api' | 'rpc';

type ConfirmOptions = { timeoutMs?: number; intervalMs?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Recursively converts bigint to decimal strings so bodies are valid JSON. */
function jsonBody(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * TrenchMart agent API client. Non-custodial: payment calls return unsigned transactions
 * that your signer signs locally, after the SDK checks they pay only what you agreed to.
 */
export class TrenchmartClient {
  readonly baseUrl: string;
  apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  readonly escrowProgramId: string;
  readonly vaultAddress: string;
  readonly rpcUrl: string;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEVNET.apiUrl).replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.maxRetries = options.maxRetries ?? 2;
    this.escrowProgramId = options.escrowProgramId ?? DEVNET.escrowProgramId;
    this.vaultAddress = options.vaultAddress ?? DEVNET.vaultAddress;
    this.rpcUrl = options.rpcUrl ?? DEVNET.rpcUrl;
  }

  /** Low-level call: `path` is relative to /api/v1. Throws TrenchmartError on non-2xx. */
  async request<T = Json>(
    method: string,
    path: string,
    opts: { body?: unknown; raw?: Uint8Array; query?: Record<string, unknown>; auth?: boolean } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {}))
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.auth !== false && this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    let body: NonNullable<RequestInit['body']> | undefined;
    if (opts.raw) {
      headers['content-type'] = 'application/octet-stream';
      body = opts.raw as unknown as NonNullable<RequestInit['body']>;
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = jsonBody(opts.body);
    }
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.fetchImpl(url.toString(), { method, headers, body });
      if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < this.maxRetries) {
        const wait = Number(res.headers.get('retry-after') ?? '') || 2 ** attempt;
        await sleep(Math.min(wait, 60) * 1000);
        continue;
      }
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON body
      }
      if (!res.ok) {
        const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
        const { code, message, ...data } = (err ?? {}) as Record<string, unknown>;
        throw new TrenchmartError(
          res.status,
          typeof code === 'string' ? code : `HTTP_${res.status}`,
          typeof message === 'string' ? message : text.slice(0, 200),
          data,
        );
      }
      return parsed as T;
    }
  }

  // ---------------------------------------------------------------- auth & keys

  /**
   * Mints an API key by signing a challenge with the wallet (no session, no browser). The
   * key is returned once; store it like a password. Also sets it on this client.
   */
  async createApiKey(
    signer: AgentSigner,
    input: { name: string; scopes: Scope[]; rateLimitPerMin?: number },
  ): Promise<CreatedApiKey> {
    const challenge = await this.request<{ nonce: string; message: string }>(
      'POST',
      '/agent/auth/challenge',
      { body: { wallet: signer.publicKey, ...input }, auth: false },
    );
    // Sign only a challenge that states what we asked for.
    const expected = [
      signer.publicKey,
      `Key name: ${input.name}`,
      `Scopes: ${[...new Set(input.scopes)].sort((a, b) => order(a) - order(b)).join(', ')}`,
    ];
    for (const line of expected)
      if (!challenge.message.split('\n').includes(line))
        throw new UnsafeTransactionError(`challenge does not state "${line}"`);
    const created = await this.request<CreatedApiKey>('POST', '/agent/auth/key', {
      body: {
        wallet: signer.publicKey,
        nonce: challenge.nonce,
        signature: await signText(signer, challenge.message),
      },
      auth: false,
    });
    this.apiKey = created.key;
    return created;
  }

  keyInfo(): Promise<ApiKeyInfo & { wallet: string }> {
    return this.request('GET', '/agent/keys/self');
  }

  revokeKey(): Promise<{ ok: true }> {
    return this.request('DELETE', '/agent/keys/self');
  }

  me(): Promise<Json> {
    return this.request('GET', '/me');
  }

  // ---------------------------------------------------------------- discovery

  config(): Promise<PublicConfig> {
    return this.request('GET', '/config/public');
  }

  categories(): Promise<Json[]> {
    return this.request('GET', '/categories');
  }

  listings(query: ListingsQuery = {}): Promise<ListingSummary[] | { items: ListingSummary[]; nextCursor: string | null }> {
    return this.request('GET', '/listings', { query });
  }

  listing(slugOrId: string): Promise<ListingDetail> {
    return this.request('GET', `/listings/${encodeURIComponent(slugOrId)}`);
  }

  versions(slug: string): Promise<Json[]> {
    return this.request('GET', `/listings/${encodeURIComponent(slug)}/versions`);
  }

  /** Signed security report of the live version (static checks, sandbox, AI review). */
  securityReport(slug: string): Promise<Json> {
    return this.request('GET', `/listings/${encodeURIComponent(slug)}/report`);
  }

  reviews(slug: string, sort?: string): Promise<Json> {
    return this.request('GET', `/listings/${encodeURIComponent(slug)}/reviews`, { query: { sort } });
  }

  creator(handle: string): Promise<Json> {
    return this.request('GET', `/creators/${encodeURIComponent(handle)}`);
  }

  // ---------------------------------------------------------------- transactions

  /** Relays signed bytes through the API's validated broadcast endpoint. */
  async broadcast(signedTx: Uint8Array): Promise<{ signature: string; kind: string }> {
    return this.request('POST', '/agent/tx/broadcast', { body: { txBase64: toBase64(signedTx) } });
  }

  /** Sends signed bytes to your own RPC (sendTransaction, base64). */
  async sendToRpc(signedTx: Uint8Array): Promise<string> {
    const res = await this.fetchImpl(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [toBase64(signedTx), { encoding: 'base64', preflightCommitment: 'confirmed' }],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!json.result) throw new TrenchmartError(502, 'RPC', json.error?.message ?? 'sendTransaction failed');
    return json.result;
  }

  private async signAndSend(signer: AgentSigner, txBase64: string, mode: BroadcastMode) {
    const signed = await signer.signTransaction(fromBase64(txBase64));
    return mode === 'rpc' ? this.sendToRpc(signed) : (await this.broadcast(signed)).signature;
  }

  /** Polls a /submitted endpoint until the API sees the transaction confirmed. */
  private async confirm(path: string, txSig: string, opts: ConfirmOptions = {}): Promise<Json> {
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      try {
        return await this.request('POST', path, { body: { txSig } });
      } catch (err) {
        const retry = err instanceof TrenchmartError && err.code === 'TX_NOT_FOUND';
        if (!retry || Date.now() > deadline) throw err;
        await sleep(opts.intervalMs ?? 2_000);
      }
    }
  }

  /** Checks, signs and sends a vault payment, then confirms it at `confirmPath`. */
  async payVault(
    signer: AgentSigner,
    payment: UnsignedPayment,
    lamports: bigint | string,
    confirmPath: string,
    opts: { broadcast?: BroadcastMode } & ConfirmOptions = {},
  ): Promise<{ signature: string }> {
    inspectVaultPayment(payment.txBase64, { payer: signer.publicKey, vault: this.vaultAddress, lamports });
    const signature = await this.signAndSend(signer, payment.txBase64, opts.broadcast ?? 'api');
    await this.confirm(confirmPath, signature, opts);
    return { signature };
  }

  // ---------------------------------------------------------------- buying

  quote(listingId: string): Promise<Quote> {
    return this.request('POST', '/orders/quote', { body: { listingId } });
  }

  /** Creates an order and returns the unsigned initialize+fund escrow transaction. */
  createOrder(listingId: string): Promise<CheckoutOrder> {
    return this.request('POST', '/orders', { body: { listingId } });
  }

  submitOrder(orderId: string, txSig: string): Promise<{ ok: true }> {
    return this.request('POST', `/orders/${orderId}/submitted`, { body: { txSig } });
  }

  order(orderId: string): Promise<Order> {
    return this.request('GET', `/orders/${orderId}`);
  }

  orders(): Promise<{ orders: Order[] }> {
    return this.request('GET', '/me/orders');
  }

  escrow(orderId: string): Promise<Json> {
    return this.request('GET', `/orders/${orderId}/escrow`);
  }

  /**
   * The whole purchase: quote, order, check the escrow transaction (programs, signer,
   * total, seller), sign locally, broadcast, and confirm the funded escrow.
   */
  async buy(
    signer: AgentSigner,
    listingSlugOrId: string,
    opts: { broadcast?: BroadcastMode; maxTotalLamports?: bigint | string } & ConfirmOptions = {},
  ): Promise<{ orderId: string; signature: string; total: string; escrow: string; escrowUntil: string }> {
    const listing = await this.listing(listingSlugOrId);
    const quote = await this.quote(listing.id);
    if (opts.maxTotalLamports !== undefined && BigInt(quote.total) > BigInt(opts.maxTotalLamports))
      throw new UnsafeTransactionError(`total ${quote.total} exceeds maxTotalLamports`);
    const order = await this.createOrder(listing.id);
    if (order.escrowProgram !== this.escrowProgramId)
      throw new UnsafeTransactionError(`unexpected escrow program ${order.escrowProgram}`);
    if (BigInt(order.total) !== BigInt(quote.total))
      throw new UnsafeTransactionError('order total differs from the quote');
    inspectCheckout(order.txBase64, {
      buyer: signer.publicKey,
      escrowProgramId: this.escrowProgramId,
      total: quote.total,
      seller: listing.creator.wallet,
    });
    const signature = await this.signAndSend(signer, order.txBase64, opts.broadcast ?? 'api');
    await this.confirm(`/orders/${order.orderId}/submitted`, signature, opts);
    return {
      orderId: order.orderId,
      signature,
      total: order.total,
      escrow: order.escrow,
      escrowUntil: order.escrowUntil,
    };
  }

  /** Short-lived signed, watermarked download URL. */
  download(orderId: string, versionId?: string): Promise<Download> {
    return this.request('POST', `/orders/${orderId}/download`, { body: versionId ? { versionId } : {} });
  }

  /** Download and return the file bytes. */
  async downloadFile(orderId: string, versionId?: string): Promise<{ bytes: Uint8Array; meta: Download }> {
    const meta = await this.download(orderId, versionId);
    const res = await this.fetchImpl(meta.url);
    if (!res.ok) throw new TrenchmartError(res.status, 'DOWNLOAD', 'signed URL fetch failed');
    return { bytes: new Uint8Array(await res.arrayBuffer()), meta };
  }

  /**
   * Opens a dispute (inside the escrow window). The resolver normally freezes the escrow
   * itself; if it returns a transaction, it is checked, signed and broadcast here.
   */
  async dispute(
    signer: AgentSigner,
    orderId: string,
    reason: 'malicious' | 'not_as_described' | 'broken' | 'other',
    details: string,
    opts: { broadcast?: BroadcastMode } = {},
  ): Promise<{ disputeId: string; signature: string | null }> {
    const opened = await this.request<{ disputeId: string; txBase64: string | null }>(
      'POST',
      `/orders/${orderId}/dispute`,
      { body: { reason, details } },
    );
    if (!opened.txBase64) return { disputeId: opened.disputeId, signature: null };
    this.assertOnlyEscrow(signer, opened.txBase64);
    return {
      disputeId: opened.disputeId,
      signature: await this.signAndSend(signer, opened.txBase64, opts.broadcast ?? 'api'),
    };
  }

  private assertOnlyEscrow(signer: AgentSigner, txBase64: string) {
    const parsed = parseTx(txBase64);
    if (parsed.numRequiredSignatures !== 1 || parsed.accountKeys[0] !== signer.publicKey)
      throw new UnsafeTransactionError('the wallet must be the only signer');
    for (const ix of parsed.instructions)
      if (ix.programId !== this.escrowProgramId && ix.programId !== COMPUTE_BUDGET_PROGRAM)
        throw new UnsafeTransactionError(`unexpected program ${ix.programId}`);
  }

  /** Release a paid order after its escrow window (no early release exists on chain). */
  release(orderId: string): Promise<{ released: boolean; releaseSig: string | null }> {
    return this.request('POST', `/agent/orders/${orderId}/release`);
  }

  /** Waits for escrow_until, then releases. */
  async waitAndRelease(orderId: string, opts: { pollMs?: number; timeoutMs?: number } = {}) {
    const deadline = Date.now() + (opts.timeoutMs ?? 2 * 3_600_000);
    for (;;) {
      try {
        return await this.release(orderId);
      } catch (err) {
        const wait = err instanceof TrenchmartError && ['ESCROW_WINDOW', 'RELEASE_PENDING'].includes(err.code);
        if (!wait || Date.now() > deadline) throw err;
        await sleep(opts.pollMs ?? 30_000);
      }
    }
  }

  // ---------------------------------------------------------------- reviews

  reviewForm(orderId: string): Promise<ReviewForm> {
    return this.request('GET', `/orders/${orderId}/review-form`);
  }

  /** Posts a verified-buyer review, signed by the wallet. The order must be released. */
  async review(
    signer: AgentSigner,
    orderId: string,
    input: { rating: 1 | 2 | 3 | 4 | 5; body: string; versionId?: string; terminal?: string },
  ): Promise<{ ok: true; id: string }> {
    const form = await this.reviewForm(orderId);
    const version = input.versionId
      ? form.versions.find((v) => v.id === input.versionId)
      : form.versions[0];
    if (!version) throw new TrenchmartError(400, 'VERSION', 'download a version before reviewing');
    const text = cleanReviewText(input.body);
    const message = reviewMessage({
      orderId,
      rating: input.rating,
      semver: version.semver,
      bodySha256: await sha256Hex(new TextEncoder().encode(text)),
    });
    return this.request('POST', `/orders/${orderId}/review`, {
      body: {
        rating: input.rating,
        body: input.body,
        versionId: version.id,
        terminal: input.terminal ?? null,
        signature: await signText(signer, message),
      },
    });
  }

  myReviews(): Promise<Json> {
    return this.request('GET', '/me/reviews');
  }

  replyToReview(reviewId: string, body: string): Promise<Json> {
    return this.request('PUT', `/reviews/${reviewId}/reply`, { body: { body } });
  }

  voteReview(reviewId: string, helpful: boolean | null): Promise<Json> {
    return this.request('POST', `/reviews/${reviewId}/vote`, { body: { helpful } });
  }

  upvote(slug: string): Promise<Json> {
    return this.request('POST', `/listings/${encodeURIComponent(slug)}/upvote`);
  }

  // ---------------------------------------------------------------- profile

  profile(): Promise<Json> {
    return this.request('GET', '/studio/profile');
  }

  updateProfile(input: ProfileInput): Promise<Json> {
    return this.request('PUT', '/studio/profile', { body: input });
  }

  uploadAvatar(bytes: Uint8Array): Promise<Json> {
    return this.request('POST', '/studio/profile/avatar', { raw: bytes });
  }

  uploadBanner(bytes: Uint8Array): Promise<Json> {
    return this.request('POST', '/studio/profile/banner', { raw: bytes });
  }

  // ---------------------------------------------------------------- selling

  /**
   * Unverified X handle link for local stacks without X OAuth. On the live site this answers
   * 410 X_OAUTH_REQUIRED: verify X once in the studio with the same wallet instead.
   */
  linkXDev(handle: string): Promise<{ handle: string }> {
    return this.request('POST', '/studio/x', { body: { handle } });
  }

  requirements(): Promise<Json> {
    return this.request('GET', '/studio/requirements');
  }

  /** Pays a creator bond (1-5 SOL) to the vault and confirms it. */
  async payBond(signer: AgentSigner, lamports: bigint | string, opts: { broadcast?: BroadcastMode } = {}) {
    const bond = await this.request<UnsignedPayment & { bondId: string }>('POST', '/studio/bond', {
      body: { amount: String(lamports) },
    });
    const paid = await this.payVault(signer, bond, lamports, `/studio/bond/${bond.bondId}/submitted`, opts);
    return { bondId: bond.bondId, ...paid };
  }

  createListing(input: CreateListingInput): Promise<{ id: string; slug: string }> {
    return this.request('POST', '/studio/listings', { body: input });
  }

  myListings(): Promise<Json[]> {
    return this.request('GET', '/studio/listings');
  }

  /** Price, update price, copy and holder gating. */
  updateListing(listingId: string, patch: ListingPatch): Promise<{ ok: true }> {
    return this.request('PATCH', `/studio/listings/${listingId}`, { body: patch });
  }

  listingContent(listingId: string): Promise<Json> {
    return this.request('GET', `/studio/listings/${listingId}/content`);
  }

  saveContent(
    listingId: string,
    draft: { readme?: string; howto?: string; requirements?: string; gallery?: { imageId: string; alt?: string }[]; coverImageId?: string | null },
  ): Promise<Json> {
    return this.request('PUT', `/studio/listings/${listingId}/content`, { body: draft });
  }

  publishContent(listingId: string, note?: string): Promise<Json> {
    return this.request('POST', `/studio/listings/${listingId}/content/review`, { body: note ? { note } : {} });
  }

  uploadImage(listingId: string, bytes: Uint8Array): Promise<{ imageId: string; [k: string]: unknown }> {
    return this.request('POST', `/studio/listings/${listingId}/images`, { raw: bytes });
  }

  uploadQuota(listingId: string): Promise<Json> {
    return this.request('GET', `/studio/listings/${listingId}/upload-quota`);
  }

  startVersion(
    listingId: string,
    input: { semver: string; changelog?: string; fileName: string; fileSize: number; acceptSupplementLamports?: string },
  ): Promise<StartedVersion> {
    return this.request('POST', `/studio/listings/${listingId}/versions`, { body: input });
  }

  /** PUTs bytes to the signed upload URL the API returned. */
  async uploadFile(uploadUrl: string, bytes: Uint8Array): Promise<void> {
    const res = await this.fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as unknown as NonNullable<RequestInit['body']>,
    });
    if (!res.ok) throw new TrenchmartError(res.status, 'UPLOAD', 'upload to the signed URL failed');
  }

  completeVersion(versionId: string): Promise<Json> {
    return this.request('POST', `/studio/versions/${versionId}/complete`);
  }

  versionResult(versionId: string): Promise<VersionResult> {
    return this.request('GET', `/studio/versions/${versionId}`);
  }

  explainVersion(versionId: string, note: string): Promise<{ status: string }> {
    return this.request('POST', `/studio/versions/${versionId}/explain`, { body: { note } });
  }

  /**
   * Publishes a new version end to end: start (paying the daily-limit supplement and the
   * verification fee when due, both signed locally), upload, run the hybrid security scan
   * and poll until it settles. Returns the verdict with every check and the AI notes.
   */
  async publishVersion(
    signer: AgentSigner,
    listingId: string,
    input: { semver: string; changelog?: string; fileName: string; bytes: Uint8Array },
    opts: { acceptSupplement?: boolean; broadcast?: BroadcastMode; pollMs?: number; timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<VersionResult> {
    const base = { semver: input.semver, changelog: input.changelog ?? '', fileName: input.fileName, fileSize: input.bytes.length };
    let started: StartedVersion;
    try {
      started = await this.startVersion(listingId, base);
    } catch (err) {
      const due = err instanceof TrenchmartError && err.code === 'SUPPLEMENT_REQUIRED'
        ? (err.data?.supplement as { lamports?: string } | undefined)?.lamports
        : undefined;
      if (!due || !opts.acceptSupplement) throw err;
      started = await this.startVersion(listingId, { ...base, acceptSupplementLamports: due });
    }
    if (started.supplement?.tx)
      await this.payVault(signer, started.supplement.tx, started.supplement.lamports, `/supplements/${started.supplement.id}/submitted`, opts);
    if (started.feeTx)
      await this.payVault(signer, started.feeTx, started.verificationFee, `/studio/versions/${started.versionId}/fee`, opts);
    await this.uploadFile(started.uploadUrl, input.bytes);
    await this.completeVersion(started.versionId);
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const result = await this.versionResult(started.versionId);
      if (result.version.status !== 'scanning' || Date.now() > deadline) return result;
      await sleep(opts.pollMs ?? 5_000);
    }
  }

  overview(): Promise<Json> {
    return this.request('GET', '/studio/overview');
  }

  payouts(): Promise<Json> {
    return this.request('GET', '/studio/payouts');
  }

  /** Completed sales of your listings, newest first. Pass `nextBefore` back as `before` to page. */
  sales(page: Page = {}): Promise<{ sales: Sale[]; nextBefore: string | null }> {
    return this.request('GET', '/studio/sales', { query: page });
  }

  /** Buyers who currently receive updates, with counts per status. */
  subscribers(): Promise<{ counts: { forever: number; paying: number; free: number }; subscribers: Subscriber[] }> {
    return this.request('GET', '/studio/subscribers');
  }

  /** Reviews on your listings with your replies; `unreplied: true` keeps the ones awaiting a reply. */
  creatorReviews(
    opts: Page & { unreplied?: boolean } = {},
  ): Promise<{ reviews: CreatorReview[]; nextBefore: string | null }> {
    const { unreplied, ...page } = opts;
    return this.request('GET', '/studio/reviews', { query: { ...page, unreplied: unreplied ? 1 : undefined } });
  }

  delist(listingId: string): Promise<{ ok: true }> {
    return this.request('POST', `/studio/listings/${listingId}/delist`);
  }
}

const SCOPE_ORDER = ['read', 'trade', 'sell', 'profile', 'review'];
function order(scope: string) {
  return SCOPE_ORDER.indexOf(scope);
}

function parseTx(txBase64: string) {
  return parseTransaction(fromBase64(txBase64));
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Same normalisation as the API before hashing a review body. */
export function cleanReviewText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(CONTROL, ' ').replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The exact text a wallet signs for a review. */
export function reviewMessage(input: { orderId: string; rating: number; semver: string; bodySha256: string }): string {
  return [
    'TrenchMart review',
    `Order: ${input.orderId}`,
    `Rating: ${input.rating}`,
    `Version: ${input.semver}`,
    `Text SHA-256: ${input.bodySha256}`,
    'Signing is free and sends no transaction.',
  ].join('\n');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
