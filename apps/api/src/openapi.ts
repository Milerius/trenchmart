import { z } from 'zod';
import {
  bondBody,
  disputeBody,
  explainBody,
  listingBody,
  listingPatch,
  orderBody,
  profileBody,
  quoteBody,
  replyBody,
  reportBody,
  reuploadBody,
  reviewPostBody,
  reviewReportBody,
  reviewVoteBody,
  devLinkBody,
  submittedBody,
  verifyJsonBody,
  versionBody,
  LISTING_KINDS,
  SPEC_SCHEMAS,
  CATEGORY_CODES,
} from '@trenchmart/shared';
import { broadcastBody, challengeBody, challengeKeyBody, studioKeyBody, scopeFor } from './agent';
import { contentBody, reviewContentBody } from './content';

/**
 * OpenAPI 3.1 description of the agent-facing API, served at /api/v1/openapi.json. Request
 * bodies are generated from the same zod schemas the handlers validate with, so the spec
 * cannot drift from what the server accepts. Each operation names the API-key scope it
 * needs (x-scope), derived from the live scope map in agent.ts.
 */

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type RouteDoc = {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  bodyType?: 'json' | 'binary';
  query?: { name: string; description: string; required?: boolean; schema?: object }[];
  /** Studio wallet session only (not reachable with an API key). */
  sessionOnly?: boolean;
  /** No auth needed at all. */
  public?: boolean;
};

const body = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' });

export const ROUTES: RouteDoc[] = [
  // Auth and keys
  {
    method: 'post',
    path: '/agent/auth/challenge',
    tag: 'Auth',
    summary: 'Start key creation: get the message the wallet must sign',
    description:
      'Returns a SIWS-style message stating the wallet, key name, scopes, rate limit and cluster. Sign its UTF-8 bytes with the wallet (ed25519) and send the base58 signature to /agent/auth/key within 10 minutes.',
    body: challengeBody,
    public: true,
  },
  {
    method: 'post',
    path: '/agent/auth/key',
    tag: 'Auth',
    summary: 'Finish key creation: exchange the signed challenge for an API key',
    description:
      'The plaintext key (tmk_...) is returned once and only its SHA-256 is stored. Creates the account on first use. A wallet can hold 10 active keys.',
    body: challengeKeyBody,
    public: true,
  },
  {
    method: 'get',
    path: '/agent/keys/self',
    tag: 'Auth',
    summary: 'Inspect the key in use (scopes, limit, wallet)',
  },
  { method: 'delete', path: '/agent/keys/self', tag: 'Auth', summary: 'Revoke the key in use' },
  {
    method: 'get',
    path: '/agent/keys',
    tag: 'Auth',
    summary: 'List keys (studio session)',
    sessionOnly: true,
  },
  {
    method: 'post',
    path: '/agent/keys',
    tag: 'Auth',
    summary: 'Create a key (studio session)',
    body: studioKeyBody,
    sessionOnly: true,
  },
  {
    method: 'delete',
    path: '/agent/keys/{id}',
    tag: 'Auth',
    summary: 'Revoke a key (studio session)',
    sessionOnly: true,
  },
  // Discovery
  { method: 'get', path: '/health', tag: 'Discovery', summary: 'Health and cluster', public: true },
  {
    method: 'get',
    path: '/config/public',
    tag: 'Discovery',
    summary: 'Fees, tier rebates, escrow window, daily limits and supplements',
    public: true,
  },
  {
    method: 'get',
    path: '/categories',
    tag: 'Discovery',
    summary: 'Categories with live listing counts',
    public: true,
  },
  {
    method: 'get',
    path: '/listings',
    tag: 'Discovery',
    summary: 'Search and list live listings',
    query: [
      { name: 'q', description: 'Full-text query' },
      {
        name: 'category',
        description: 'Category code',
        schema: { type: 'string', enum: [...CATEGORY_CODES] },
      },
      { name: 'terminal', description: 'Terminal name (Axiom, GMGN, Photon, ...)' },
      {
        name: 'sort',
        description: 'Sort order',
        schema: {
          type: 'string',
          enum: ['trending', 'new', 'price_asc', 'price_desc', 'rating', 'top'],
        },
      },
      { name: 'cursor', description: 'Pagination cursor from the previous page' },
      { name: 'limit', description: '1-48', schema: { type: 'integer', minimum: 1, maximum: 48 } },
    ],
    public: true,
  },
  {
    method: 'get',
    path: '/listings/{slug}',
    tag: 'Discovery',
    summary: 'A listing with its security block and creator card (slug or id)',
    public: true,
  },
  {
    method: 'get',
    path: '/listings/{slug}/versions',
    tag: 'Discovery',
    summary: 'Public version history',
    public: true,
  },
  {
    method: 'get',
    path: '/listings/{slug}/report',
    tag: 'Discovery',
    summary: 'Signed security report of the live version (scan checks, AI review, sha256)',
    public: true,
  },
  {
    method: 'get',
    path: '/listings/{slug}/reviews',
    tag: 'Discovery',
    summary: 'Reviews with rating summary',
    public: true,
  },
  {
    method: 'get',
    path: '/listings/{slug}/upvotes',
    tag: 'Discovery',
    summary: 'Upvote tally',
    public: true,
  },
  { method: 'get', path: '/creators/top', tag: 'Discovery', summary: 'Top creators', public: true },
  {
    method: 'get',
    path: '/creators/{handle}',
    tag: 'Discovery',
    summary: 'Creator profile and listings',
    public: true,
  },
  {
    method: 'get',
    path: '/transparency',
    tag: 'Discovery',
    summary: 'On-chain escrow and treasury state',
    public: true,
  },
  { method: 'get', path: '/prices/sol', tag: 'Discovery', summary: 'SOL/USD used for display', public: true },
  { method: 'get', path: '/me', tag: 'Account', summary: 'The wallet behind the key, roles and tier' },
  // Buying
  {
    method: 'post',
    path: '/orders/quote',
    tag: 'Buy',
    summary: 'Price, 5% fee, tier rebate and total in lamports',
    body: quoteBody,
  },
  {
    method: 'post',
    path: '/orders',
    tag: 'Buy',
    summary: 'Create an order and get the unsigned escrow transaction (initialize + fund + memo)',
    description:
      'Returns orderId, escrow (PDA), escrowUntil and txBase64: a serialized legacy transaction whose fee payer and only signer is your wallet. Sign it locally (it expires with its blockhash, about 60-90 s), then POST it to /agent/tx/broadcast or send it to your own RPC, then call /orders/{id}/submitted.',
    body: orderBody,
  },
  {
    method: 'post',
    path: '/orders/{id}/submitted',
    tag: 'Buy',
    summary: 'Confirm payment: the API verifies the funded escrow on chain',
    description:
      'Send the confirmed transaction signature. Answers 400 TX_NOT_FOUND until the transaction is confirmed; retry. On success the order is paid and the license is granted.',
    body: submittedBody,
  },
  { method: 'get', path: '/orders/{id}', tag: 'Buy', summary: 'One of your orders' },
  { method: 'get', path: '/orders/{id}/escrow', tag: 'Buy', summary: 'Live escrow account of an order' },
  { method: 'get', path: '/me/orders', tag: 'Buy', summary: 'Your orders with update entitlements' },
  {
    method: 'post',
    path: '/orders/{id}/download',
    tag: 'Buy',
    summary: 'Signed, watermarked download URL (valid 5 minutes)',
    description:
      'Paid or released orders only. Optional body {"versionId"} picks an entitled version; default is the latest entitled one.',
  },
  { method: 'get', path: '/orders/{id}/versions', tag: 'Buy', summary: 'Versions this order is entitled to' },
  { method: 'post', path: '/orders/{id}/updates/quote', tag: 'Buy', summary: 'Quote an update renewal' },
  {
    method: 'post',
    path: '/orders/{id}/updates/renew',
    tag: 'Buy',
    summary: 'Unsigned renewal payment transaction',
  },
  {
    method: 'post',
    path: '/orders/{id}/updates/{renewalId}/submitted',
    tag: 'Buy',
    summary: 'Confirm a renewal payment',
    body: submittedBody,
  },
  {
    method: 'post',
    path: '/orders/{id}/dispute',
    tag: 'Buy',
    summary: 'Open a dispute inside the escrow window',
    description:
      'The resolver freezes the escrow on chain. If that fails, txBase64 is an unsigned open_dispute transaction for you to sign and broadcast.',
    body: disputeBody,
  },
  {
    method: 'post',
    path: '/orders/{id}/dispute/tx',
    tag: 'Buy',
    summary: 'Fresh unsigned open_dispute transaction',
  },
  {
    method: 'post',
    path: '/agent/orders/{id}/release',
    tag: 'Buy',
    summary: 'Release a paid order after its escrow window (buyer or seller)',
    description:
      'release is permissionless on chain once escrow_until has passed; this runs it now instead of waiting for the 5-minute crank. Answers 409 ESCROW_WINDOW before the window ends. There is no early release.',
  },
  {
    method: 'post',
    path: '/agent/tx/broadcast',
    tag: 'Transactions',
    summary: 'Relay a signed transaction the API issued to you',
    description:
      'Rejects anything that is not byte-for-byte a transaction the API built for this wallet in the last 3 minutes: altered programs, accounts, amounts, memo or blockhash, extra signers, a different fee payer, invalid signatures, versioned messages. Returns the signature; it is not confirmed yet.',
    body: broadcastBody,
  },
  { method: 'get', path: '/verify/quota', tag: 'Buy', summary: 'Free file checks left today' },
  {
    method: 'post',
    path: '/verify',
    tag: 'Buy',
    summary: 'Check a file against pinned versions (sha256 match)',
    body: verifyJsonBody,
  },
  {
    method: 'post',
    path: '/verify/supplement',
    tag: 'Buy',
    summary: 'Unsigned supplement payment after the free check',
  },
  {
    method: 'post',
    path: '/supplements/{id}/submitted',
    tag: 'Transactions',
    summary: 'Confirm a supplement payment (verify or daily upload limit)',
    body: submittedBody,
  },
  // Selling
  {
    method: 'get',
    path: '/studio/requirements',
    tag: 'Sell',
    summary: 'What listing needs: verified X, category bond, verification fee',
  },
  {
    method: 'post',
    path: '/studio/bond',
    tag: 'Sell',
    summary: 'Unsigned bond payment (1-5 SOL) to the vault',
    body: bondBody,
  },
  {
    method: 'post',
    path: '/studio/bond/{id}/submitted',
    tag: 'Sell',
    summary: 'Confirm the bond payment',
    body: submittedBody,
  },
  {
    method: 'post',
    path: '/studio/listings',
    tag: 'Sell',
    summary: 'Create a listing (any kind, with its specs)',
    description:
      'Needs a verified X link and the category bond. license=subscription with subPeriodDays makes a subscription. kind + specs follow the per-kind schemas in components.schemas (ListingSpecs_*).',
    body: listingBody,
  },
  { method: 'get', path: '/studio/listings', tag: 'Sell', summary: 'Your listings' },
  {
    method: 'patch',
    path: '/studio/listings/{id}',
    tag: 'Sell',
    summary: 'Edit title, summary, description, price, update price, holder gating',
    body: listingPatch,
  },
  { method: 'get', path: '/studio/listings/{id}/content', tag: 'Sell', summary: 'Page content (draft and live)' },
  {
    method: 'put',
    path: '/studio/listings/{id}/content',
    tag: 'Sell',
    summary: 'Save the page draft (readme, how-to, requirements, gallery, cover)',
    body: contentBody,
  },
  {
    method: 'post',
    path: '/studio/listings/{id}/content/review',
    tag: 'Sell',
    summary: 'Submit the page draft for AI review and publish it',
    body: reviewContentBody,
  },
  {
    method: 'post',
    path: '/studio/listings/{id}/images',
    tag: 'Sell',
    summary: 'Upload a gallery image (raw PNG/JPEG/WebP body, max 3 MB)',
    bodyType: 'binary',
  },
  {
    method: 'delete',
    path: '/studio/listings/{id}/images/{imageId}',
    tag: 'Sell',
    summary: 'Delete an image',
  },
  {
    method: 'post',
    path: '/studio/listings/{id}/versions',
    tag: 'Sell',
    summary: 'Start a version: returns a signed upload URL and any fee or supplement transaction',
    description:
      'Daily limits apply (uploads per creator per day, updates per listing per day). Past them, the response asks for a supplement: repeat the call with acceptSupplementLamports, sign supplement.tx, broadcast, and confirm it at /supplements/{id}/submitted. A verification fee (feeTx) applies below the fee-free tier.',
    body: versionBody,
  },
  {
    method: 'get',
    path: '/studio/listings/{id}/upload-quota',
    tag: 'Sell',
    summary: 'Daily limits left, fees and recent versions',
  },
  {
    method: 'put',
    path: '/files',
    tag: 'Sell',
    summary: 'Upload the file bytes to the signed upload URL',
    description: 'Use the uploadUrl as returned (it carries its own signature). Raw body.',
    bodyType: 'binary',
    public: true,
  },
  {
    method: 'post',
    path: '/studio/versions/{id}/fee',
    tag: 'Sell',
    summary: 'Confirm the verification fee payment',
    body: submittedBody,
  },
  {
    method: 'post',
    path: '/studio/versions/{id}/fee-tx',
    tag: 'Sell',
    summary: 'Fresh unsigned fee and supplement transactions',
  },
  {
    method: 'post',
    path: '/studio/versions/{id}/complete',
    tag: 'Sell',
    summary: 'Pin the upload (sha256) and run the security scan',
    description:
      'Runs the hybrid pipeline (static rules, sandbox for scripts, AI review). Add ?stream=1 for server-sent step events. The final status is live, needs_creator, rejected or scanning; poll GET /studio/versions/{id} for checks and the AI verdict.',
  },
  {
    method: 'get',
    path: '/studio/versions/{id}',
    tag: 'Sell',
    summary: 'Scan result: status, every check (rule, result, detail) and the AI review',
  },
  {
    method: 'post',
    path: '/studio/versions/{id}/explain',
    tag: 'Sell',
    summary: 'Answer the AI when a version needs a creator note',
    body: explainBody,
  },
  {
    method: 'post',
    path: '/studio/versions/{id}/reupload',
    tag: 'Sell',
    summary: 'Upload a fixed file when the AI requests changes',
    body: reuploadBody,
  },
  {
    method: 'get',
    path: '/studio/overview',
    tag: 'Sell',
    summary: 'Sales, revenue, buyers and subscribers, per listing and over time',
  },
  { method: 'get', path: '/studio/payouts', tag: 'Sell', summary: 'Payouts to your wallet' },
  { method: 'post', path: '/studio/listings/{id}/delist', tag: 'Sell', summary: 'Delist a listing' },
  // Profile
  { method: 'get', path: '/studio/profile', tag: 'Profile', summary: 'Your editable profile' },
  {
    method: 'put',
    path: '/studio/profile',
    tag: 'Profile',
    summary: 'Edit handle, display name, bio, socials and contact channels',
    body: profileBody,
  },
  {
    method: 'post',
    path: '/studio/profile/avatar',
    tag: 'Profile',
    summary: 'Upload an avatar (raw image body, max 3 MB)',
    bodyType: 'binary',
  },
  { method: 'delete', path: '/studio/profile/avatar', tag: 'Profile', summary: 'Remove the avatar' },
  {
    method: 'post',
    path: '/studio/profile/banner',
    tag: 'Profile',
    summary: 'Upload a banner (raw image body, max 3 MB)',
    bodyType: 'binary',
  },
  { method: 'delete', path: '/studio/profile/banner', tag: 'Profile', summary: 'Remove the banner' },
  {
    method: 'post',
    path: '/studio/x',
    tag: 'Profile',
    summary: 'Unverified X handle link (only where X OAuth is not configured; 410 otherwise)',
    body: devLinkBody,
  },
  // Reviews
  {
    method: 'get',
    path: '/orders/{id}/review-form',
    tag: 'Reviews',
    summary: 'Whether the order can be reviewed, the versions you downloaded and the text rules',
  },
  {
    method: 'post',
    path: '/orders/{id}/review',
    tag: 'Reviews',
    summary: 'Post or edit a verified-buyer review (released orders, wallet-signed)',
    description:
      'signature is the wallet ed25519 signature (base58) of the UTF-8 text: "TrenchMart review\\nOrder: <orderId>\\nRating: <1-5>\\nVersion: <semver>\\nText SHA-256: <hex sha256 of the trimmed body>\\nSigning is free and sends no transaction." versionId must be a version this wallet downloaded (see review-form). The SDK helper reviewMessage() builds it.',
    body: reviewPostBody,
  },
  { method: 'get', path: '/me/reviews', tag: 'Reviews', summary: 'Reviews you wrote' },
  {
    method: 'put',
    path: '/reviews/{id}/reply',
    tag: 'Reviews',
    summary: 'Creator reply to a review of your listing',
    body: replyBody,
  },
  {
    method: 'post',
    path: '/reviews/{id}/vote',
    tag: 'Reviews',
    summary: 'Helpful vote (true, false, or null to clear)',
    body: reviewVoteBody,
  },
  {
    method: 'post',
    path: '/reviews/{id}/report',
    tag: 'Reviews',
    summary: 'Report a review',
    body: reviewReportBody,
  },
  { method: 'post', path: '/listings/{slug}/upvote', tag: 'Reviews', summary: 'Toggle your upvote' },
  {
    method: 'post',
    path: '/listings/{slug}/report',
    tag: 'Reviews',
    summary: 'Report a listing',
    body: reportBody,
  },
];

function pathParams(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/** The scope an operation needs, as the live middleware computes it. */
export function scopeOf(route: RouteDoc): string {
  if (route.public) return 'none';
  if (route.sessionOnly) return 'session';
  const sample = route.path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
  const rule = scopeFor(route.method.toUpperCase(), sample);
  if (rule === 'open') return 'any';
  if (rule === 'denied') return 'session';
  return rule.anyOf.join(' | ');
}

let cached: { key: string; spec: object } | null = null;

export function openApiSpec(input: { apiUrl: string; cluster: string }): object {
  const key = `${input.apiUrl}|${input.cluster}`;
  if (cached?.key === key) return cached.spec;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    const scope = scopeOf(route);
    const op: Record<string, unknown> = {
      tags: [route.tag],
      summary: route.summary,
      operationId: `${route.method}${route.path
        .replace(/\{(\w+)\}/g, 'By_$1')
        .split(/[/-]/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join('')}`,
      'x-scope': scope,
      parameters: [
        ...pathParams(route.path),
        ...(route.query ?? []).map((q) => ({
          name: q.name,
          in: 'query',
          required: q.required ?? false,
          description: q.description,
          schema: q.schema ?? { type: 'string' },
        })),
      ],
      responses: {
        '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
        default: {
          description: 'Error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
    if (route.description) op.description = route.description;
    if (route.public) op.security = [];
    else if (route.sessionOnly) op.security = [{ session: [] }];
    else op.security = [{ apiKey: [] }, { session: [] }];
    if (route.body) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: body(route.body) } },
      };
    } else if (route.bodyType === 'binary') {
      op.requestBody = {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      };
    }
    (paths[route.path] ??= {})[route.method] = op;
  }
  const specSchemas: Record<string, unknown> = {};
  for (const kind of LISTING_KINDS) {
    specSchemas[`ListingSpecs_${kind.code}`] = {
      ...body(SPEC_SCHEMAS[kind.code]),
      description: `${kind.label}: lists under category ${kind.category}. Files: ${kind.files}.`,
    };
  }
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'TrenchMart agent API',
      version: '1.0.0',
      summary: `Non-custodial API for AI agents to buy and sell on TrenchMart (Solana ${input.cluster}).`,
      description: [
        `Cluster: ${input.cluster}. Amounts are integer lamports as decimal strings.`,
        'Authenticate with `Authorization: Bearer tmk_...`. Mint a key by signing a challenge with the wallet (POST /agent/auth/challenge, then /agent/auth/key) or create one in the studio. Scopes: read, trade, sell, profile, review. x-scope on each operation names what it needs.',
        'Non-custodial: the API never holds keys. Payment endpoints return unsigned legacy transactions (txBase64) whose only signer is your wallet. Sign locally, then broadcast through POST /agent/tx/broadcast (validated relay) or your own RPC, then confirm with the matching /submitted endpoint.',
        'Errors: {"error":{"code","message"}}. 401 INVALID_API_KEY, 403 INSUFFICIENT_SCOPE or KEY_FORBIDDEN, 429 RATE_LIMIT (see Retry-After and X-RateLimit-* headers).',
        'Docs: https://trenchmart.fun/docs/agents. LLM summary: https://trenchmart.fun/llms.txt.',
      ].join('\n\n'),
    },
    servers: [{ url: `${input.apiUrl}/api/v1`, description: input.cluster }],
    tags: ['Auth', 'Discovery', 'Account', 'Buy', 'Transactions', 'Sell', 'Profile', 'Reviews'].map(
      (name) => ({ name }),
    ),
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'tmk_ API key',
          description: 'Scoped API key. Per-key limit 1-300 requests/min (default 60).',
        },
        session: { type: 'apiKey', in: 'cookie', name: 'tm_session', description: 'Studio wallet session' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
        ...specSchemas,
      },
    },
  };
  cached = { key, spec };
  return spec;
}
