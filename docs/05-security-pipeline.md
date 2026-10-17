# 05 · Security pipeline

Goal: nothing reaches a buyer unless (1) its bytes were frozen at upload, (2) automated checks passed or a warning was explained, (3) a staked human approved that exact hash.

```
 CREATOR                API / WORKERS              REVIEW                LIVE
 ① Sign in (SIWS), link X, stake bond
 ② Upload ──▶ sha256 ──▶ R2 blobs/<hash> (immutable) ──▶ status=scanning
 ③ Static scan ─┬─ (userscript/alerts) ─▶ Sandbox run
                └────────────┬──────────┘
          FAIL → rejected · WARN → needs_creator (explain/fix) · else
 ④ in_review ──▶ verifier reads code + report ──▶ signs decision
 ⑤ approve ──▶ live (attestation stored) ──▶ public listing
 New file = new version = back to ②
```

## 1 · Upload & pinning

- Presigned PUT to `uploads/<versionId>` (max size from config). Content-Type ignored; type inferred from extension + magic bytes.
- On `/complete`: stream the object, compute sha256, reject if the hash already exists on another creator's listing (stolen upload), copy to `blobs/<sha256>`, delete temp. Store `r2_key = blobs/<sha256>`.
- `blobs/` objects are never overwritten or deleted while any order references them.
- `.zip` (setups): unzip in the Worker (`fflate`), reject nested archives, symlinks, paths with `..`, > 200 entries, or > 25 MB uncompressed. Each entry is scanned by its own type and stored as a manifest in `versions.declared.files`.

## 2 · Static scan (`packages/scanner`)

Pure function: `scan(file: {name, bytes}, category) → { engineVer, checks: Check[] }`. Parse JS with `acorn` (ecmaVersion latest, allow hash-bang), walk with `acorn-walk`. Parse the `==UserScript==` header into `declared`.

### Rules for `userscript` / JS in `alerts`

| rule_id                      | Result    | Triggers                                                                                                                                                                                                                                                                       |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `header-valid`               | fail      | Missing/invalid `==UserScript==` block, no `@match`/`@include`                                                                                                                                                                                                                 |
| `match-scope`                | warn      | `@match *://*/*`, `<all_urls>`, or `@include *`                                                                                                                                                                                                                                |
| `no-eval`                    | fail      | `eval(`, `new Function(`, `setTimeout/setInterval` with string arg, `import()` of non-literal                                                                                                                                                                                  |
| `no-remote-code`             | fail      | `@require` from hosts outside allowlist (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com`) or without SRI hash; `<script src>` injection; `document.createElement('script')` with dynamic src                                                                           |
| `no-obfuscation`             | fail      | Heuristics: string-array rotator (`X.push(X.shift())` on one array, with a ≥ 10 string array or `while (!![])`), > 30% of identifiers matching `_0x[0-9a-f]+`, entropy of string literals > 5.5 bits/char over > 2 KB, single line > 5000 chars, `atob`+`eval`/Function chains |
| `no-sign-transaction`        | fail      | Member access or call of `signTransaction`, `signAllTransactions`, `signAndSendTransaction`, `sendTransaction`, `signMessage`; access to `window.solana`, `window.phantom`, `window.backpack`, `window.solflare`, `window.ethereum`                                            |
| `no-key-access`              | fail      | Strings or regex matching base58 64-byte secret-key pattern, `"privateKey"`, `"secretKey"`, `"mnemonic"`, `"seed"` used as property; reading `localStorage`/`sessionStorage`/`indexedDB` keys containing `key`, `wallet`, `seed`, `phrase`, `secret`                           |
| `no-clipboard-read`          | fail      | `navigator.clipboard.readText`/`read`                                                                                                                                                                                                                                          |
| `no-clipboard-write-address` | warn      | `clipboard.writeText` (address-swap attacks) — reviewer must check                                                                                                                                                                                                             |
| `network-declared`           | warn      | `fetch`, `XMLHttpRequest`, `GM_xmlhttpRequest`, `GM.xmlHttpRequest`, `WebSocket`, `navigator.sendBeacon`, `new Image().src=` to a host not in `@connect`, or dynamic URL                                                                                                       |
| `network-allowlist`          | warn      | Any outbound host at all (lists hosts for the report)                                                                                                                                                                                                                          |
| `no-dom-wallet-tamper`       | warn      | Selectors/text replacement targeting address fields, "Confirm", "Approve", wallet popups                                                                                                                                                                                       |
| `grant-minimal`              | warn      | `@grant` includes `GM_cookie`, `GM_download`, `unsafeWindow` without need                                                                                                                                                                                                      |
| `deps`                       | pass/warn | Lists `@require`s with SRI; warn if any                                                                                                                                                                                                                                        |

### Rules for data files

| Category      | rule_id          | Check                                                                                                           |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `wallet_list` | `wl-schema`      | JSON array or CSV with `address` column; each a valid base58 32-byte pubkey; ≤ 5000 rows; dedupe count reported |
| `wallet_list` | `wl-no-programs` | Warn if addresses are known program IDs or the creator's own wallet                                             |
| `filter`      | `filter-schema`  | Valid JSON matching `packages/shared/schemas/filter.ts` (per-terminal schema, unknown keys warn)                |
| any           | `links`          | URLs extracted; warn if not https or on a blocklist (`BLOCKLIST_HOSTS` config)                                  |
| `strategy`    | `doc-safe`       | `.md` only text; `.pdf` reject JavaScript/embedded files/launch actions (`pdf-lib` inspect)                     |

`summary` = worst of results (`fail > warn > pass`). Store every check as a `scan_checks` row with locations (line/col/snippet ≤ 200 chars). Bump `engineVer` whenever rules change; re-scan live versions in the background and flag regressions to admins.

### Antivirus (`av-signatures`, every file and every zip entry)

`packages/scanner/src/av.ts` runs inside the Worker. It fails a file on an exact SHA-256 match
(EICAR plus any hashes passed as `blockedSha256`), on native executables (PE, ELF, Mach-O
magic), on the EICAR string, and on string signatures of known crypto-targeting families
(Inferno/Angel/Pink/Monkey/Venom/MS drainer kits, CLINKSINK, CoinHive, CryptoLoot,
WebMinePool, `stratum+tcp://`, CryptoNight wasm). It warns on common exfiltration channels
(Telegram bot API, Discord webhooks), since legit alert tools use them too. When `CLAMAV_URL`
is configured the uploaded file is also posted to a ClamAV REST shim; an unreachable or
malformed answer is a `warn`, never a pass.

Limits, stated plainly: this is a small curated signature set, not a full antivirus. It has no
heuristics engine, no unpacking and no emulation, so a novel, repacked or lightly modified
sample will not match. The static rules, the sandbox and the AI review remain the main
defence for scripts; this pass catches known-bad payloads cheaply and early.

## 3 · Sandbox run (QuickJS-wasm, inline in the Worker)

The Worker runs each userscript in a QuickJS engine compiled to wasm
(`packages/scanner/src/isolate.ts`), with a 128 MB memory limit, a 15 s wall budget, an
interrupt handler and a 60 s virtual clock that fires timers, rAF and DOMContentLoaded. The
script sees a browser-like page (DOM element factory, `location` from `@match`, storage,
`structuredClone`, `URL`, `TextEncoder`, GM APIs, observers, wallet providers). Nothing leaves
the isolate: `fetch`, XHR, WebSocket, beacons, script and image `src` are recorded by host and
fail closed. Verdicts: wallet signing calls or provider overwrites, a timeout or OOM fail; script
errors, network attempts or clipboard use warn (the AI then asks the creator to explain); a
clean run passes. A script that throws never passes (`sandbox-runtime`). If the engine itself
cannot start, or an external runner answers non-2xx, the version goes to `needs_creator` with
`resume_step = 'sandbox'` and no verdict: the creator retries the review.

### Legacy external runner (`apps/sandbox`, VPS)

Only for `userscript` and JS `alerts`. Loop: poll `GET /internal/sandbox/next` every 10s.

Per job:

1. Fresh Chromium profile via Playwright with Tampermonkey extension loaded (or inject the script with `addInitScript` wrapping a minimal GM_* shim — simpler and fine for POC; record which mode ran).
2. A **burner devnet/mainnet wallet** stub: inject a fake `window.solana` / `window.phantom.solana` provider that logs every method call (`connect`, `signTransaction`, `signMessage`, …) and never signs. Any call to a signing method = **fail**.
3. Visit each `@match` target (from config `sandbox_targets`: e.g. `https://axiom.trade/pulse`, `https://gmgn.ai/?chain=sol`) for 3 minutes each, scroll, click a few safe UI elements.
4. Record: all requests (host, method, path, size), WebSocket opens, clipboard calls, storage reads, console errors, DOM mutations on input fields.
5. Post result to `/internal/sandbox/:versionId/result`:

```json
{
  "mode": "init-script",
  "durationMs": 540000,
  "requests": [{ "host": "api.telegram.org", "method": "POST", "count": 3 }],
  "walletCalls": [],
  "clipboard": [],
  "storageReads": ["tm_presets"],
  "errors": [],
  "verdict": "pass|warn|fail",
  "notes": "..."
}
```

Server converts to `scan_checks`: `sandbox-wallet-calls` (fail if any), `sandbox-network` (warn if any host ∉ `@connect`, fail if host on blocklist), `sandbox-errors` (warn).

Note: the sandbox is evidence, not proof (scripts can be time- or user-triggered). Human review stays mandatory.

## 4 · Human review

- Verifier UI shows: file with syntax highlight, diff vs previous live version, every check with locations highlighted, sandbox network log, creator note, creator history.
- Decision requires notes (≥ 20 chars) and a wallet signature over `trenchmart-attest:v1:<versionId>:<sha256>:<decision>:<iso>`.
- A verifier can't review their own listings or a creator they've flagged as related.
- Phase 2: publish attestations on-chain (memo tx or a small program) and show the tx link.

## 5 · Delivery & watermark

- On download, build a per-order copy: for `.user.js`, insert after the header block:
  `// trenchmart-license: <orderId> <buyerWallet> <sha256-of-reviewed-file>`
  For JSON, add top-level `"_trenchmart": {order, wallet, sha256}`. For zip, add `LICENSE-trenchmart.txt`.
- Cache the watermarked copy at `licensed/<orderId>/<fileName>` and sign a 5-minute GET URL.
- Public verify tool (`/verify` page + `POST /api/v1/verify`): strip the watermark line/field, hash, compare to the listed version's `sha256` → "Matches reviewed v2.1.3" or "Does not match". This keeps the hash-pinning promise checkable by buyers.

## 6 · After live

- "Report this listing" on every listing → creates a dispute (if buyer) or an admin report (anyone).
- Upheld `malicious` dispute: delist all versions of the listing, refund all orders of the affected versions from escrow (if not released) else from bond, then safety fund; slash bond; ban creator; notify buyers.
- Re-scan all live versions when `engineVer` changes.

## Trust signals shown in UI (must be truthful)

| Badge                  | Shown when                                            |
| ---------------------- | ----------------------------------------------------- |
| `✓ VERIFIED · vX`      | live version with approve attestation                 |
| `◷ IN REVIEW`          | newer version pending; show previous live as verified |
| `Bond staked N SOL`    | active bond amount                                    |
| `Disputes lost N`      | count upheld disputes                                 |
| `Identity: X + wallet` | x linked                                              |

## Listing pages (README, How to use, gallery)

Seller-written pages are untrusted input and go through their own review before buyers see them.

**Storage.** `listing_content.draft` holds what the seller is editing; only `listing_content.live`
is ever returned by the public API. Saving a draft never changes the live page, so a page stays
up while a new draft is reviewed.

**Images** (`apps/api/src/image.ts`, max 12 in the gallery, 3 MB each, 40 uploads per listing):

- The type comes from the file's magic bytes (PNG, JPEG, WebP). The client's Content-Type is ignored;
  SVG, GIF, HTML and polyglots are refused.
- Dimensions are 16–8192 px per side and at most 40 MP.
- Metadata is removed by rewriting the container: PNG keeps only rendering chunks (each CRC is
  checked); JPEG drops APP1 (EXIF/XMP), APP3–13, APP15 and comments; WebP drops EXIF/XMP chunks.
  Bytes after the end of the image are dropped. Known limitation: the EXIF orientation flag goes
  with the rest of EXIF, so a phone photo can show rotated.
- Stored in R2 at `media/<sha256>.<ext>` and served from `/api/v1/media/:id` with the sniffed
  Content-Type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Content-Disposition: inline`, `Cross-Origin-Resource-Policy: same-site`. An image is public only
  once a live page references it; until then only the owner can load it (`private, no-store`).

**Markdown** is parsed (CommonMark + GFM) into a whitelisted tree and rendered as React elements;
it never goes through `innerHTML`. Raw HTML shows as text. Links are limited to http(s), mailto,
relative paths and anchors, and external links get `rel="noopener noreferrer nofollow ugc"`.
Images may only point at our own `/api/v1/media/<id>`; anything else becomes an
"External image removed" chip, so pages cannot hotlink trackers. Version changelogs are not
reviewed, so they render with links switched off.

**Review** (`packages/scanner/src/content.ts`, engine `content@1.0.0`) runs on submit:

| Check                    | Fails on                                                                                            | Warns on                          |
| ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------- |
| content-link-scheme      | `javascript:`, `data:`, `vbscript:`, `file:` links, also written as plain text                      |                                   |
| content-html             | script-capable HTML (`<script>`, `on*=` handlers, iframes, SVG, forms)                              | other raw HTML                    |
| content-phishing         | lookalike brand domains (homoglyphs, one edit away), punycode, `user@host` links, blocklisted hosts |                                   |
| content-link-hygiene     |                                                                                                     | shorteners, bare IPs, plain http  |
| content-offsite-download | executables and extensions (`.exe`, `.msi`, `.crx`, `.xpi`, …)                                      | file hosts, archives, loose `.js` |
| content-secret-request   | asking for a seed phrase or private key                                                             |                                   |
| content-images           | images from another listing                                                                         | remote images                     |

The checks feed the same AI verifier used for files: a failure rejects, a warning needs a creator
explanation of at least 20 characters, and the decision is signed as
`trenchmart-ai-attest:v1:content-<listingId>:<sha256 of the draft>:<decision>:<time>`. On approval the
draft is copied to `live` together with the list of media ids it references.
