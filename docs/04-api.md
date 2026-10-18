# 04 · API (Hono, `apps/api`)

Base: `/api/v1`. JSON. Errors: `{ "error": { "code": "STRING", "message": "..." } }`. Auth via `tm_session` cookie. Lamports serialized as **strings** in JSON.

Legend: 🔓 public · 👤 signed in · 🛠 creator · 🔍 verifier · 🛡 admin · 🤖 internal/webhook

## Auth

| Method | Path               | Who | Body → Response                                                                 |
| ------ | ------------------ | --- | ------------------------------------------------------------------------------- |
| POST   | `/auth/nonce`      | 🔓  | `{wallet}` → `{nonce, message}`                                                 |
| POST   | `/auth/verify`     | 🔓  | `{wallet, signature}` → sets cookie, `{user}`                                   |
| POST   | `/auth/logout`     | 👤  | → 204                                                                           |
| GET    | `/me`              | 👤  | → `{user, roles, tier, tierDetail:{minBalance, windowHours, nextTier, needed}}` |
| GET    | `/auth/x/start`    | 👤  | → 302 to X OAuth                                                                |
| GET    | `/auth/x/callback` | 👤  | → links X, 302 to studio                                                        |

SIWS message format:

```
trenchmart.xyz wants you to sign in with your Solana account:
<wallet>

Sign in to Trenchmart. This does not send a transaction.

URI: https://trenchmart.xyz
Nonce: <nonce>
Issued At: <iso>
Expiration Time: <iso +10m>
```

## Browse

| Method | Path                       | Who | Notes                                                                                                                                                                                                                                                                       |
| ------ | -------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/listings`                | 🔓  | query: `q, category, terminal, sort=trending\|new\|price_asc\|price_desc\|rating, cursor, limit≤48`. Hides holder-only-window listings from tier `none` (shows them with `lockedUntil`).                                                                                    |
| GET    | `/listings/:slug`          | 🔓  | listing + live version + creator card + `security` block                                                                                                                                                                                                                    |
| GET    | `/listings/:slug/versions` | 🔓  | changelog (live/superseded only)                                                                                                                                                                                                                                            |
| GET    | `/listings/:slug/reviews`  | 🔓  | paginated                                                                                                                                                                                                                                                                   |
| GET    | `/creators/top`            | 🔓  | 30d volume                                                                                                                                                                                                                                                                  |
| GET    | `/categories`              | 🔓  | from enum + counts                                                                                                                                                                                                                                                          |
| GET    | `/status`                  | 🔓  | public status page data: overall state, per-component state, latency p50/p95 and 90 daily bars (`none` for days without probes), sanitized incidents. Allowlisted fields only (no alert text, wallets or balances). Edge-cached 60 s, CORS `*`. See docs/ops/status-page.md |

`security` block shape (drives the Security report tab):

```ts
{
  versionId, semver, sha256,
  summary: 'pass'|'warn'|'fail',
  passed: number, total: number,
  checks: { ruleId, result, title, detail }[],
  declared: { match: string[], grant: string[], connect: string[], require: string[] },
  review: { verifierHandle, decision, signedAt, signature, attestation } | null,
  walletCount: WalletCount | null   // wallet lists only, see below
}
```

Wallet lists (`kind: 'wallet'`) carry a **verified wallet count**. Sellers never type it: the
static scan parses the uploaded file and counts the unique valid Solana addresses (base58,
32–44 characters, decoding to 32 bytes), and each version stores its own count, so a new
version is recounted. `specs.walletCount` is not part of the wallet specs any more; a value sent
by an older client is dropped. `GET /listings/:slug` returns it at the top level and in
`security`, and `GET /listings/:slug/versions` returns `walletCount` per version:

```ts
type WalletCount = {
  count: number; // unique valid Solana addresses in the live version's file
  versionId: string;
  semver: string;
  source: 'file';
  facts: {
    format: 'standard' | 'json' | 'csv' | 'txt';
    rows: number;
    duplicates: number;
    invalid: number;
    named?: number; // standard export: wallets with a name
    alertTypes?: string[]; // standard export: alert types subscribed in the list
  } | null;
};
```

Formats the scan reads, in order: the wallet-tracker standard export (a JSON array of
`{ chain, address, name, emoji, alertSubscriptions, groupIds, fundingInfo, … }`; only top-level
`address` with `chain: "solana"` counts, never `fundingInfo` addresses), a JSON array of
addresses or `{ address | wallet | walletAddress | pubkey }` objects (also `{ wallets: [...] }`
or an object keyed by address), CSV with an `address`/`wallet` column, and TXT with one address
per line (`#` and `//` comments skipped). Upload the standard export as `.txt` or `.json`.

## Checkout & orders

| Method | Path                    | Who | Notes                                                                                                                                                                                                                 |
| ------ | ----------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/orders/quote`         | 👤  | `{listingId}` → `{price, fee, rebate, total, tier, feeBps, rebateBps}` (no DB write)                                                                                                                                  |
| POST   | `/orders`               | 👤  | `{listingId}` → creates PENDING order, returns `{orderId, total, memo, vault, txBase64}` (unsigned transfer + memo instruction, recent blockhash). Rejects: own listing, holder-only lock, already owns live license. |
| POST   | `/orders/:id/submitted` | 👤  | `{txSig}` → stores sig, verifies immediately if confirmed (also done by webhook)                                                                                                                                      |
| GET    | `/orders/:id`           | 👤  | status poll                                                                                                                                                                                                           |
| GET    | `/me/orders`            | 👤  | purchases                                                                                                                                                                                                             |
| POST   | `/orders/:id/download`  | 👤  | → `{url, expiresAt}` signed R2 URL (5 min) to the watermarked copy. Requires status paid/released/disputed and valid license.                                                                                         |
| POST   | `/orders/:id/review`    | 👤  | `{rating, body}` once per order, after paid                                                                                                                                                                           |
| POST   | `/orders/:id/dispute`   | 👤  | `{reason, details}` only while `now < escrow_until` (malicious: allowed up to 30 days, paid from bond/safety fund)                                                                                                    |

## Creator studio

| Method | Path                            | Who | Notes                                                                                                                                                                             |
| ------ | ------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/studio/requirements`          | 👤  | `{walletSigned, bondRequired, bondActive, bondOk, verificationFee, feeWaived, xLinked (optional), xRequired: false}`                                                              |
| POST   | `/studio/bond`                  | 👤  | `{amount}` → unsigned tx to vault with memo `bond:<id>`                                                                                                                           |
| POST   | `/studio/bond/:id/submitted`    | 👤  | `{txSig}`                                                                                                                                                                         |
| POST   | `/studio/listings`              | 🛠   | create draft listing                                                                                                                                                              |
| PATCH  | `/studio/listings/:id`          | 🛠   | edit metadata (price changes apply to new orders only)                                                                                                                            |
| POST   | `/studio/listings/:id/versions` | 🛠   | `{semver, changelog, fileName, fileSize}` → `{versionId, uploadUrl}` (presigned R2 PUT to `uploads/<versionId>`) + verification fee tx if not waived                              |
| POST   | `/studio/versions/:id/complete` | 🛠   | server reads `uploads/<versionId>`, computes sha256, copies to `blobs/<sha256>`, deletes temp, status → scanning, enqueue `scan-static`. Wallet lists: response has `walletCount` |
| GET    | `/studio/versions/:id`          | 🛠   | pipeline status + checks                                                                                                                                                          |
| POST   | `/studio/versions/:id/explain`  | 🛠   | `{note}` → needs_creator → in_review                                                                                                                                              |
| GET    | `/studio/payouts`               | 🛠   | history                                                                                                                                                                           |
| POST   | `/studio/listings/:id/delist`   | 🛠   | self-delist                                                                                                                                                                       |

## Verifier

| Method | Path                               | Who | Notes                                                                                                                   |
| ------ | ---------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | `/review/queue`                    | 🔍  | versions in_review, oldest first, excludes own listings                                                                 |
| GET    | `/review/versions/:id`             | 🔍  | file contents (text), diff vs previous live version, scans, creator note                                                |
| POST   | `/review/versions/:id/attestation` | 🔍  | `{decision}` → message to sign: `trenchmart-attest:v1:<versionId>:<sha256>:<decision>:<iso>`                            |
| POST   | `/review/versions/:id/decide`      | 🔍  | `{decision, notes, signature}` → verify sig; approve → live (old live → superseded, `listings.live_version_id` updated) |

## Admin

| Method | Path                              | Notes                                                       |
| ------ | --------------------------------- | ----------------------------------------------------------- |
| GET    | `/admin/disputes`                 | open disputes                                               |
| POST   | `/admin/disputes/:id/resolve`     | `{status:'upheld'\|'rejected', resolution, slashLamports?}` |
| POST   | `/admin/listings/:id/delist`      |                                                             |
| PUT    | `/admin/config/:key`              |                                                             |
| GET    | `/admin/payouts/batches`          | proposed batches for multisig                               |
| POST   | `/admin/payouts/batches/:id/sent` | `{txSig}`                                                   |
| POST   | `/admin/users/:id/roles`          | grant verifier etc.                                         |

## Internal / webhooks

| Method | Path                                  | Notes                                                                                                                                                                                                                             |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/hooks/helius`                       | 🤖 `Authorization: <HELIUS_WEBHOOK_SECRET>`. Handles (a) SOL transfers to vault → match memo → mark order/bond paid; (b) $TRENCH token transfers → insert `token_balances` rows for affected wallets. Idempotent on tx signature. |
| GET    | `/internal/sandbox/next`              | 🤖 `INTERNAL_TOKEN`. Returns next sandbox job `{versionId, fileUrl, declared, targetUrls}` or 204                                                                                                                                 |
| POST   | `/internal/sandbox/:versionId/result` | 🤖 result payload (see 05)                                                                                                                                                                                                        |
| POST   | `/internal/status/run`                | 🤖 `INTERNAL_TOKEN`. Runs one status tick (probes, incidents, roll-up) now; the API cron runs it every 5 min                                                                                                                      |
| POST   | `/internal/status/external`           | 🤖 `STATUS_PUSH_TOKEN` (watchdog only). `{checks:[{name: web\|api\|rpc, ok, ms}]}`; 401 when the token is unset or short                                                                                                          |

## Payment verification (shared by webhook and `/submitted`)

1. Fetch tx via Helius `getTransaction` (commitment `confirmed`, then re-check `finalized` before release).
2. Assert: a SystemProgram transfer from `buyer.wallet` to `VAULT_ADDRESS` of exactly `order.total` lamports, and a Memo instruction equal to `order.memo`.
3. Order still `pending` and not expired (allow a 5-min grace after `expires_at` if tx block time is before it).
4. Set `paid`, `tx_sig`, `paid_at`, `escrow_until = paid_at + escrow_hours` (1h max; escrow orders: fixed on chain at checkout, ≤ paid_at + 1h); ledger `+total vault`; create `licenses` row.
5. Over/under-payment → order stays pending, flag for admin, never auto-refund.
