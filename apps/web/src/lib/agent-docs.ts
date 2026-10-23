import { CLUSTER } from '@/lib/cluster';
import { ENDPOINTS } from '@/lib/cluster-endpoints';
import {
  ABUSE_LIMITS,
  API_SCOPES,
  CHALLENGE_TTL_MS,
  DEFAULT_CONFIG_JSON,
  DEFAULT_KEY_RATE,
  ISSUED_TX_TTL_MS,
  MAX_ACTIVE_KEYS,
  MAX_KEY_RATE,
  KEY_DAILY_QUOTA,
  WALLET_KEY_RATE,
  IP_KEY_RATE,
  SCOPE_DESCRIPTIONS,
  type ApiScope,
} from '@trenchmart/shared';
import spec from '@trenchmart/sdk/openapi.json';
import { DEVNET_ADDRESSES, ESCROW_PROGRAM_ID, bpsPercent, protocol } from './protocol-facts';

/** Single source for the agent docs pages, llms.txt and llms-full.txt. Devnet only. */
export const SITE = 'https://trenchmart.fun';
export const API_BASE = ENDPOINTS[CLUSTER.id].apiBase;
export const OPENAPI_URL = `${API_BASE}/openapi.json`;
export const SDK_PACKAGE = '@trenchmart/sdk';
export const REPO_URL = 'https://github.com/Milerius/trenchmart';
export const EXAMPLES_URL = `${REPO_URL}/tree/main/examples`;
/** The API's per-IP limit on writes (POST/PUT/PATCH/DELETE), on top of the per-key limit. */
export const IP_WRITE_LIMIT_PER_MIN = 120;

export type Endpoint = {
  method: string;
  path: string;
  scope: string;
  summary: string;
  description?: string;
  operationId: string;
};

type SpecOp = {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  'x-scope'?: string;
};

const TAG_ORDER = [
  'Auth',
  'Discovery',
  'Account',
  'Buy',
  'Transactions',
  'Sell',
  'Featuring',
  'Profile',
  'Reviews',
];

export const TAG_INTRO: Record<string, string> = {
  Auth: 'Mint and manage API keys. Open routes: no key needed to request or redeem a challenge.',
  Discovery:
    'Public catalogue: listings, versions, signed security reports, reviews, creators, config.',
  Account: 'Your account and orders.',
  Buy: 'Quote, checkout (unsigned escrow transaction), confirm, download, dispute, release.',
  Transactions: 'Relay signed transactions through the validated broadcast endpoint.',
  Sell: 'Everything the studio does: bond, listings, media, versions and scans, prices, supplements, sales, subscribers, reviews, payouts.',
  Featuring:
    'Paid featured spots for your listings (home, category, band): config, calendar, quote, book (unsigned SOL payment), confirm, cancel.',
  Profile: 'Profile, socials, contact channels, avatar and banner.',
  Reviews: 'Signed verified-buyer reviews, creator replies, helpful votes, reports and upvotes.',
};

export const apiVersion: string = (spec as { info: { version: string } }).info.version;

/** Every documented operation, grouped by tag in docs order. */
export function endpointGroups(): { tag: string; endpoints: Endpoint[] }[] {
  const paths = (spec as { paths: Record<string, Record<string, SpecOp>> }).paths;
  const groups = new Map<string, Endpoint[]>();
  for (const [path, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = op.tags?.[0] ?? 'Other';
      const list = groups.get(tag) ?? [];
      list.push({
        method: method.toUpperCase(),
        path,
        scope: op['x-scope'] ?? 'none',
        summary: op.summary ?? '',
        description: op.description,
        operationId: op.operationId ?? `${method}${path}`,
      });
      groups.set(tag, list);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([tag, endpoints]) => ({ tag, endpoints }));
}

function rank(tag: string) {
  const i = TAG_ORDER.indexOf(tag);
  return i === -1 ? TAG_ORDER.length : i;
}

export const endpointCount = endpointGroups().reduce((n, g) => n + g.endpoints.length, 0);

export const SCOPES = API_SCOPES.map((scope: ApiScope) => ({
  scope,
  text: SCOPE_DESCRIPTIONS[scope],
}));

export const AGENT_LIMITS = {
  maxActiveKeys: MAX_ACTIVE_KEYS,
  defaultKeyRate: DEFAULT_KEY_RATE,
  maxKeyRate: MAX_KEY_RATE,
  challengeMinutes: CHALLENGE_TTL_MS / 60_000,
  issuedTxMinutes: ISSUED_TX_TTL_MS / 60_000,
  ipWritesPerMin: IP_WRITE_LIMIT_PER_MIN,
  ipReadsPerMin: ABUSE_LIMITS.read.limit,
  groups: ABUSE_LIMITS,
  keyDailyQuota: KEY_DAILY_QUOTA,
  walletKeyRate: WALLET_KEY_RATE,
  ipKeyRate: IP_KEY_RATE,
};

export const ERRORS: { status: number; code: string; meaning: string }[] = [
  {
    status: 400,
    code: 'BAD_REQUEST',
    meaning: 'Body or query failed validation; `fields` names each problem.',
  },
  {
    status: 401,
    code: 'INVALID_API_KEY',
    meaning: 'Unknown, revoked or expired key (same answer for all three).',
  },
  {
    status: 401,
    code: 'NONCE_USED',
    meaning: 'Challenge already redeemed or expired: request a new one.',
  },
  {
    status: 401,
    code: 'BAD_SIGNATURE',
    meaning: 'The challenge signature does not verify for that wallet.',
  },
  {
    status: 403,
    code: 'INSUFFICIENT_SCOPE',
    meaning: 'The key lacks the scope the route needs (`x-scope`).',
  },
  {
    status: 403,
    code: 'KEY_FORBIDDEN',
    meaning: 'Route not available to API keys (admin, sign-in, key management).',
  },
  { status: 403, code: 'BANNED', meaning: 'The wallet is banned.' },
  {
    status: 409,
    code: 'KEY_LIMIT',
    meaning: `The wallet already holds ${MAX_ACTIVE_KEYS} active keys.`,
  },
  {
    status: 429,
    code: 'RATE_LIMIT',
    meaning: 'Per-key, per-wallet or per-IP limit hit. Wait `Retry-After` seconds.',
  },
  {
    status: 429,
    code: 'DAILY_QUOTA',
    meaning: 'The key used its daily request quota. It resets at 00:00 UTC (`Retry-After`).',
  },
  {
    status: 400,
    code: 'BAD_TX',
    meaning: 'Broadcast bytes are not a well-formed signed legacy transaction.',
  },
  {
    status: 400,
    code: 'WRONG_SIGNER',
    meaning: 'Broadcast transaction is not signed by the key\u2019s wallet as sole signer.',
  },
  {
    status: 400,
    code: 'FOREIGN_PROGRAM',
    meaning: 'Broadcast transaction calls a program outside the allowlist.',
  },
  {
    status: 400,
    code: 'NOT_ISSUED',
    meaning: 'Message is not byte-identical to one the API issued to this wallet.',
  },
  {
    status: 410,
    code: 'TX_EXPIRED',
    meaning: `Issued message older than ${ISSUED_TX_TTL_MS / 60_000} minutes: build a new one.`,
  },
  {
    status: 400,
    code: 'TX_WOULD_FAIL',
    meaning: 'Simulation failed before anything was sent (reason included).',
  },
  {
    status: 400,
    code: 'TX_NOT_FOUND',
    meaning: 'A /submitted call ran before the transaction confirmed: retry.',
  },
  { status: 409, code: 'ALREADY_OWNED', meaning: 'This wallet already owns the listing.' },
  { status: 400, code: 'OWN_LISTING', meaning: 'A creator cannot buy its own listing.' },
  {
    status: 403,
    code: 'ESCROW_LOCKED',
    meaning: 'Download before payment is confirmed, or while a dispute is open.',
  },
  { status: 409, code: 'ESCROW_WINDOW', meaning: 'Release asked before escrow_until.' },
  {
    status: 400,
    code: 'BOND_REQUIRED',
    meaning: 'Stake the category bond first (POST /studio/bond).',
  },
  {
    status: 402,
    code: 'SUPPLEMENT_REQUIRED',
    meaning: 'Daily upload/update limit used: retry with `acceptSupplementLamports`.',
  },
  {
    status: 409,
    code: 'SEMVER_TAKEN',
    meaning: 'That version number already exists on the listing.',
  },
  { status: 503, code: 'CHECKOUT_PAUSED', meaning: 'Checkout is paused by the operators.' },
];

export const FACTS = {
  cluster: 'devnet',
  programId: ESCROW_PROGRAM_ID,
  vault: DEVNET_ADDRESSES.vault,
  fee: protocol.marketplaceFeeLabel,
  feeBps: protocol.marketplaceFeeBps,
  escrowWindow: protocol.escrowWindow,
  orderTtlMinutes: protocol.orderTtlMinutes,
  downloadUrlSeconds: protocol.downloadUrlSeconds,
  verificationFee: protocol.verificationFee,
  verificationFeeFreeFrom: protocol.verificationFeeFreeFrom,
  uploadsPerCreatorPerDay: protocol.uploadsPerCreatorPerDay,
  updatesPerListingPerDay: protocol.updatesPerListingPerDay,
  uploadSupplement: protocol.uploadSupplement,
  updateFreeDays: protocol.updateFreeDays,
  updatePriceDefault: protocol.updatePriceDefault,
  tierWindowHours: protocol.tierWindowHours,
  creatorCommission: protocol.creatorCommission,
  rebates: `Scout ${bpsPercent(DEFAULT_CONFIG_JSON.tier_rebate_bps.scout)}, Trencher ${bpsPercent(DEFAULT_CONFIG_JSON.tier_rebate_bps.trencher)}, OG ${bpsPercent(DEFAULT_CONFIG_JSON.tier_rebate_bps.og)} of the fee`,
};

/** Minimal end-to-end buyer, shown on the docs and in llms-full.txt. */
export const QUICKSTART_TS = `import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { TrenchmartClient, keypairSigner } from '@trenchmart/sdk';

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('./agent.json', 'utf8'))),
);
const signer = keypairSigner(keypair.secretKey); // signs locally, never sent
const tm = new TrenchmartClient(); // live devnet API

// 1. Mint a scoped key by signing a challenge (no transaction).
await tm.createApiKey(signer, { name: 'my-agent', scopes: ['read', 'trade', 'review', 'profile'] });

// 2. Buy: quote -> unsigned escrow tx -> checked + signed locally -> broadcast -> confirmed.
const order = await tm.buy(signer, 'trojan-trenches-intel', { maxTotalLamports: 200_000_000n });

// 3. Download the watermarked file (signed URL, ${protocol.downloadUrlSeconds} s).
const { bytes } = await tm.downloadFile(order.orderId);

// 4. After the ${protocol.escrowWindow} escrow window: release, then a signed review.
await tm.waitAndRelease(order.orderId);
await tm.review(signer, order.orderId, { rating: 5, body: 'Installed and works as described.' });

// 5. Upvote it and fill in your buyer profile.
await tm.upvote('trojan-trenches-intel');
await tm.updateProfile({ displayName: 'My Agent', bio: 'Buys and reviews tools on devnet.' });

// 6. Done: revoke the key (or keep it for the next run).
await tm.revokeKey();`;

export const SELLER_TS = `const tm = new TrenchmartClient();
await tm.createApiKey(signer, { name: 'seller', scopes: ['read', 'sell', 'profile', 'review'] });

await tm.updateProfile({ displayName: 'Alpha Bot', bio: 'Signals for Axiom.', socials: { website: 'alpha.example' } });
const req = await tm.requirements(); // bondActive, bondByCategory, verificationFee (xLinked is optional)
if (!req.bondOk) await tm.payBond(signer, 1_000_000_000n); // unsigned vault tx, signed here

const { id } = await tm.createListing({
  title: 'Axiom Alpha Overlay', summary: 'Smart-money badges on Axiom.', description: '...',
  category: 'userscript', kind: 'script', terminals: ['Axiom'], priceLamports: '150000000',
  specs: { managers: ['Tampermonkey'], browsers: ['Chrome'], readsPage: true, network: 'none',
           hosts: [], tradeButtons: false, storage: 'none' },
});

// Supplement (daily limit) and verification fee are unsigned txs signed locally; then the
// hybrid scan runs and the verdict comes back with every check and the AI review notes.
const result = await tm.publishVersion(signer, id,
  { semver: '1.0.0', changelog: 'First release', fileName: 'alpha.user.js', bytes },
  { acceptSupplement: true });
console.log(result.version.status, result.checks, result.review);

await tm.updateListing(id, { priceLamports: '120000000', updatePriceLamports: '12000000' });
const { sales } = await tm.sales();
const { counts } = await tm.subscribers();
for (const r of (await tm.creatorReviews({ unreplied: true })).reviews)
  await tm.replyToReview(r.id, 'Thanks for the feedback!');

// Feature it on the home page for 3 days (paid in SOL, signed locally).
await tm.featureListing(signer, { listingId: id, kind: 'home', startDay: '2026-10-20', days: 3 });`;

export const CURL_CHALLENGE = `curl -s ${API_BASE}/agent/auth/challenge \\
  -H 'content-type: application/json' \\
  -d '{"wallet":"<base58 pubkey>","name":"my-agent","scopes":["read","trade"]}'
# -> { "nonce": "...", "message": "trenchmart.fun wants you to create an API key ...", "expiresAt": "..." }
# Sign the exact message bytes (UTF-8) with ed25519, base58-encode the signature, then:
curl -s ${API_BASE}/agent/auth/key \\
  -H 'content-type: application/json' \\
  -d '{"wallet":"<pubkey>","nonce":"<nonce>","signature":"<base58 sig>"}'
# -> { "key": "tmk_...", "id": "...", "scopes": [...], "rateLimitPerMin": ${DEFAULT_KEY_RATE} }  (shown once)`;

export const NOT_AVAILABLE = [
  'Webhooks are not available: poll GET /studio/versions/{id} for scan results and GET /orders/{id} for order state.',
  'X verification (optional, a trust badge) is a one-time human step in the studio (OAuth in a browser); keys cannot link X. It is never needed to list, publish or sell.',
  'Mainnet: TrenchMart runs on Solana devnet only. Never send mainnet funds.',
];

function line(e: Endpoint) {
  return `- ${e.method} ${e.path} [${e.scope}]: ${e.summary}`;
}

/** https://llmstxt.org index served raw at /llms.txt. */
export function llmsTxt(): string {
  return `# TrenchMart

> TrenchMart is a marketplace for crypto trading tools (userscripts, wallet lists, filters, setups, strategies, alerts) on Solana devnet, with every purchase held in an on-chain escrow for ${protocol.escrowWindow}. AI agents can buy and sell through a non-custodial REST API: the API returns unsigned transactions and the agent signs them with its own keypair.

Network: Solana devnet only (escrow program ${ESCROW_PROGRAM_ID}). Amounts are integer lamports as decimal strings. Buyer fee ${protocol.marketplaceFeeLabel} of the price (reduced by $MART tier rebates); creators keep the full list price.

## Agent API

- [Agent API docs](${SITE}/docs/agents): auth, scopes, limits, sign/broadcast flow, buying, selling, errors
- [Endpoint reference](${SITE}/docs/agents/reference): all ${endpointCount} operations with their scope
- [TypeScript SDK](${SITE}/docs/agents/sdk): ${SDK_PACKAGE}, typed client with buy/sell/review helpers
- [OpenAPI 3.1 spec](${OPENAPI_URL}): machine-readable, x-scope per operation
- [Full text for LLMs](${SITE}/llms-full.txt): everything above in one file

## Examples

- [Example buyer and seller agents](${EXAMPLES_URL}): TypeScript, @solana/web3.js keypair, run against live devnet

## Marketplace docs

- [Buyers](${SITE}/docs/buyers): checkout, escrow, downloads, disputes
- [Sellers](${SITE}/docs/sellers): bonds, verification, versions, daily limits
- [Fees](${SITE}/docs/fees): fee, tiers and rebates, treasury split
- [Escrow program](${SITE}/docs/escrow): instructions and state machine
- [Security](${SITE}/docs/security): hybrid scan, signed reports

## Optional

- [FAQ](${SITE}/docs/faq)
- [Source code](${REPO_URL})
`;
}

/** Everything an LLM needs in one file, served raw at /llms-full.txt. */
export function llmsFullTxt(): string {
  const groups = endpointGroups()
    .map((g) => `### ${g.tag}\n\n${TAG_INTRO[g.tag] ?? ''}\n\n${g.endpoints.map(line).join('\n')}`)
    .join('\n\n');
  return `# TrenchMart agent API (full text)

> Non-custodial REST API for AI agents to buy and sell trading tools on TrenchMart. Solana devnet only. API version ${apiVersion}. Base URL ${API_BASE}. OpenAPI 3.1: ${OPENAPI_URL}. Human docs: ${SITE}/docs/agents.

## Ground rules

- Network: Solana devnet only. Escrow program ${ESCROW_PROGRAM_ID}. Vault ${DEVNET_ADDRESSES.vault}. Never send mainnet funds.
- Non-custodial: the API never sees a private key. Payment routes return \`txBase64\`, a serialized unsigned legacy transaction whose fee payer and only signer is your wallet. You sign locally.
- Amounts are integer lamports encoded as decimal strings (1 SOL = 1000000000).
- Errors: \`{ "error": { "code": "UPPER_SNAKE", "message": "...", ...details } }\` with an HTTP status.
- Live values (fees, limits, bonds, terminals): GET ${API_BASE}/config/public.

## Authentication

Send \`Authorization: Bearer tmk_...\` on every request. A key acts as one wallet with a set of scopes. Keys are stored hashed (SHA-256); the secret is shown once.

Mint a key without a browser (wallet-signed challenge, no transaction):
1. POST /agent/auth/challenge {"wallet","name","scopes",["rateLimitPerMin"]} -> {"nonce","message","expiresAt"}. The message states the domain, wallet, key name, scopes, rate limit, cluster (devnet), nonce and expiry. Check it before signing.
2. Sign the exact message bytes (UTF-8) with the wallet's ed25519 key; base58-encode the 64-byte signature.
3. POST /agent/auth/key {"wallet","nonce","signature"} -> {"key":"tmk_...","id","prefix","scopes","rateLimitPerMin"}. A challenge is single-use and expires after ${CHALLENGE_TTL_MS / 60_000} minutes. The wallet's account is created if it does not exist.

Or create keys in the studio: ${SITE}/studio/api-keys (create, list, revoke).
An agent can read its own key (GET /agent/keys/self) and revoke it (DELETE /agent/keys/self).

\`\`\`bash
${CURL_CHALLENGE}
\`\`\`

## Scopes

${SCOPES.map((s) => `- ${s.scope}: ${s.text}`).join('\n')}

Every operation in the OpenAPI spec carries \`x-scope\`. Routes for admins, sign-in sessions and studio key management answer 403 KEY_FORBIDDEN to API keys. When a Bearer key is sent, any session cookie is ignored.

## Limits

- Per key: \`rateLimitPerMin\` requests per minute across all methods (default ${DEFAULT_KEY_RATE}, max ${MAX_KEY_RATE}). Every response carries X-RateLimit-Limit and X-RateLimit-Reset (X-RateLimit-Remaining when known). 429 RATE_LIMIT includes Retry-After.
- Per key per day: ${KEY_DAILY_QUOTA} requests (UTC day; X-Quota-Limit, X-Quota-Remaining). Past it, 429 DAILY_QUOTA until 00:00 UTC.
- Per wallet: ${WALLET_KEY_RATE} requests per minute across all of its keys.
- Per IP: ${IP_KEY_RATE} API-key requests per minute, ${IP_WRITE_LIMIT_PER_MIN} writes per minute (POST, PUT, PATCH, DELETE) and ${ABUSE_LIMITS.read.limit} reads (GET) per minute. IPv6 counts per /64.
- Per route group, per IP and per signed-in wallet, each per minute: sign-in (/auth/*, /agent/auth/*) ${ABUSE_LIMITS.auth.limit}, transactions (/orders*, /tx/*, /agent/tx/*, /agent/orders/*, bonds, fees, featuring bookings, supplements) ${ABUSE_LIMITS.tx.limit}, /verify* ${ABUSE_LIMITS.verify.limit}, uploads (/files, listing images, content, versions, reupload, profile) ${ABUSE_LIMITS.upload.limit}. A full buy or sell flow uses well under these. 429 RATE_LIMIT carries Retry-After.
- Keys per wallet: ${MAX_ACTIVE_KEYS} active.
- Sellers: ${protocol.uploadsPerCreatorPerDay} new uploads per creator per day and ${protocol.updatesPerListingPerDay} update per listing per day (UTC). Past that, a version needs a paid supplement (${protocol.uploadSupplement} per extra upload; GET /studio/listings/{id}/upload-quota has the exact quote).

## Fees

- Buyer pays price + ${protocol.marketplaceFeeLabel} fee - tier rebate. Rebates by $MART tier (held for ${protocol.tierWindowHours} h): ${FACTS.rebates}.
- Creators keep 100% of the list price (commission ${protocol.creatorCommission}).
- Verification fee: ${protocol.verificationFee} per version (waived from tier ${protocol.verificationFeeFreeFrom}). Category bond: see /config/public (bonds) and /studio/requirements.
- Updates: buyers get ${protocol.updateFreeDays} days of updates; then the listing's update price (default ${protocol.updatePriceDefault} of the price) per period.

## Signing and broadcasting

1. Get \`txBase64\` from a payment route (checkout, bond, supplement, verification fee, renewal, dispute).
2. Decode and check it before signing: fee payer and only signer = your wallet; programs limited to ComputeBudget, System, Memo and the escrow program; amounts as quoted. The SDK does this for you (inspectCheckout, inspectVaultPayment) and throws UnsafeTransactionError otherwise.
3. Sign the message with your keypair.
4. Send it either way:
   - POST /agent/tx/broadcast {"txBase64": signed} (scope trade or sell) -> {"signature","kind"}. The API relays only a message byte-identical to one it issued to this key's wallet in the last ${ISSUED_TX_TTL_MS / 60_000} minutes, signed by that wallet as sole signer, calling only allowlisted programs. Anything else is refused (NOT_ISSUED, WRONG_SIGNER, BAD_SIGNATURE, FOREIGN_PROGRAM, TX_EXPIRED, BAD_TX).
   - or sendTransaction on your own devnet RPC.
5. Confirm with the matching /submitted route ({"txSig"}). It answers 400 TX_NOT_FOUND until the transaction is confirmed: retry every 2 s.
Blockhashes expire after about 60-90 s: sign and send promptly, or request a fresh transaction.

## Buying

1. GET /listings (filters: q, category, terminal, sort, limit, cursor) and GET /listings/{slug}; read GET /listings/{slug}/report (signed security report).
2. POST /orders/quote {"listingId"} -> price, fee, rebate, total.
3. POST /orders {"listingId"} -> {orderId, escrow, escrowUntil, total, txBase64}. One transaction: initialize + fund the escrow PDA + memo. An unpaid order expires (default ${protocol.orderTtlMinutes} minutes; live value order_ttl_minutes in /config/public).
4. Sign, broadcast, then POST /orders/{id}/submitted {"txSig"}.
5. POST /orders/{id}/download -> signed, watermarked URL valid ${protocol.downloadUrlSeconds} s. Each call returns a fresh URL; pass {"versionId"} for an older version you own.
6. Escrow window ${protocol.escrowWindow}: dispute with POST /orders/{id}/dispute (returns an escrow-only tx to sign) if the file is malicious or not as described.
7. After escrow_until: POST /agent/orders/{id}/release (buyer or seller) runs the permissionless release crank for that order. 409 ESCROW_WINDOW before the window ends.
8. Review (needs a released order and a downloaded version): GET /orders/{id}/review-form, sign the review message, POST /orders/{id}/review. The signed message is:
   TrenchMart review\\nOrder: <orderId>\\nRating: <1-5>\\nVersion: <semver>\\nText SHA-256: <hex sha256 of the cleaned text>\\nSigning is free and sends no transaction.
9. Upvote (scope review): POST /listings/{slug}/upvote {"up": true} (or {"up": false} to remove it). One weighted upvote per wallet per listing, capped per wallet per day (429 UPVOTE_LIMIT); not on your own listing (403 OWN_LISTING). Tally: GET /listings/{slug}/upvotes.
10. Your profile as a buyer (scope profile): GET/PUT /studio/profile (handle, displayName, bio, socials). Every wallet has one; it is what creators and other buyers see next to your reviews.

## Selling (everything the studio does)

- Profile and socials: GET/PUT /studio/profile (handle, displayName, bio, socials, contact), POST /studio/profile/avatar and /banner (image bytes).
- Requirements: GET /studio/requirements -> bondRequired, bondActive, bondOk, bondByCategory, bondRequiredByCategory, bondOkByCategory, verificationFee, feeWaived, xLinked, xRequired (always false). Creating a listing in a category needs bondRequiredByCategory[category] (the same check the API runs: the highest bond of your live categories and that one, OG discount applied; bondOkByCategory says whether it passes now; bondRequired/bondOk are the cheapest category); every version passes the security scan. X is optional: a verified X link (one-time, OAuth in the studio) adds a trust badge on your profile and listings and is never required to list, publish or sell.
- Bond: POST /studio/bond {"amount"} (1-5 SOL per stake) -> unsigned vault tx; sign, send, POST /studio/bond/{id}/submitted.
- Listings: POST /studio/listings with title, summary, description, category (userscript, wallet_list, filter, setup, strategy, alerts), terminals, priceLamports, license (single, multi3, subscription + subPeriodDays), updatePriceLamports, holderOnly/holderOnlyHours, kind and kind-specific specs (schemas ListingSpecs_<kind> in the OpenAPI spec: script, bot, wallet, filter, indicator, telegram, other). PATCH /studio/listings/{id} changes title, copy, price, update/subscription price, holder gating. POST /studio/listings/{id}/delist.
- Content and media: GET/PUT /studio/listings/{id}/content (readme, howto, requirements markdown; gallery of uploaded image ids; coverImageId), POST /studio/listings/{id}/content/review to publish the draft, POST /studio/listings/{id}/images (image bytes).
- Versions: GET /studio/listings/{id}/upload-quota; POST /studio/listings/{id}/versions {semver, changelog, fileName, fileSize, [acceptSupplementLamports]} -> {versionId, uploadUrl, feeTx, supplement}. 402 SUPPLEMENT_REQUIRED carries the quote; retry with acceptSupplementLamports. Pay supplement.tx (POST /supplements/{id}/submitted) and feeTx (POST /studio/versions/{id}/fee), PUT the file bytes to uploadUrl, then POST /studio/versions/{id}/complete.
- Scan result: poll GET /studio/versions/{id} -> version.status (scanning, live, needs_creator, rejected), checks [{rule_id, result pass|warn|fail, title, detail}], review {decision, notes}. If needs_creator: POST /studio/versions/{id}/explain {"note"}. There are no webhooks.
- Business: GET /studio/overview (30-day revenue and sales, subscribers, ratings, disputes), GET /studio/sales (each sale with buyer, amounts, status, tx), GET /studio/subscribers (forever, paying, free), GET /studio/payouts.
- Reviews: GET /studio/reviews?unreplied=1, PUT /reviews/{id}/reply {"body"} (one reply per review, editable).

## Not available

${NOT_AVAILABLE.map((t) => `- ${t}`).join('\n')}

## Errors

${ERRORS.map((e) => `- ${e.status} ${e.code}: ${e.meaning}`).join('\n')}

## TypeScript SDK (${SDK_PACKAGE})

Typed client over this API with local signing and safety checks. Signers: keypairSigner(secretKey) or walletAdapterSigner(adapter, Transaction). Retries 429/502/503 honouring Retry-After. Docs: ${SITE}/docs/agents/sdk.

\`\`\`ts
${QUICKSTART_TS}
\`\`\`

Seller agent:

\`\`\`ts
${SELLER_TS}
\`\`\`

## Endpoint reference (${endpointCount} operations, [scope])

${groups}
`;
}
