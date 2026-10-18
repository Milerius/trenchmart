import { pendingMigrations } from '@trenchmart/db';
import { deliverAlerts, notify, opsAlertRows, opsCheck, opsStatus, recordOpsEvent } from './ops';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  buildSiwsMessage,
  bondMemo,
  CATEGORIES,
  categoryMeta,
  jsonSafe,
  listingsQuery,
  randomNonce,
  bondToList,
  requiredBondLamports,
  signJwt,
  siwsExpiresAt,
  tierAtLeast,
  verifyJwt,
  verifySiwsSignature,
  verificationFeeMemo,
  bondBody,
  buybackBody,
  configValueBody,
  devLinkBody,
  disputeBody,
  explainBody,
  listingBody,
  listingPatch,
  nonceBody,
  orderBody,
  quoteBody,
  reportBody,
  resolveDisputeBody,
  roleBody,
  submittedBody,
  verifyBody,
  verifyJsonBody,
  reuploadBody,
  versionBody,
  batchSentBody,
  txBroadcastBody,
  stripWatermark,
  formatSol,
  moneyView,
  canonicalTerminal,
} from '@trenchmart/shared';
import { fromBase64, sendRaw } from '@trenchmart/chain';
import { cachedSolUsd, fetchSolUsd, type PriceCache } from './price';
import type { Env } from './env';
import { BlobUnavailableError } from './blob';
import {
  contentBody,
  deleteImage,
  isUuid,
  mediaResponse,
  mediaUrl,
  publicContent,
  reviewContentBody,
  reviewContent,
  saveDraft,
  studioContent,
  uploadImage,
  optimizeStoredImages,
} from './content';
import { IMAGE_MAX_BYTES } from '@trenchmart/scanner';
import { EscrowError } from './escrow';
import { checkXState, fetchXAccount, startXAuth, X_COOKIE, XAuthError, xVerified } from './x-oauth';
import {
  findCreator,
  loadOwnProfile,
  profileMediaResponse,
  publicProfile,
  removeProfileImage,
  saveProfile,
  uploadProfileImage,
} from './profile';
import {
  retryTransientRead,
  studioOverview,
  studioReviews,
  studioSales,
  studioSubscribers,
} from './studio';
import { registerReviewRoutes } from './reviews';
import { computeRanks, registerUpvoteRoutes } from './ranking';
import { featuredToday, registerFeaturingRoutes, featureMaintenance } from './featuring';
import { paidToCreators, registerLeaderboardRoutes } from './leaderboard';
import { scanWalletIntel } from './social';
import {
  authenticateApiKey,
  consumeKeyRate,
  isApiKeyHeader,
  registerAgentRoutes,
  scopeFor,
  type ApiKeyContext,
} from './agent';
import { openApiSpec } from './openapi';
import {
  activeBond,
  applyPayment,
  grantCreatorRole,
  audit,
  buildVaultTx,
  createOrder,
  ensureSnapshot,
  expireOrders,
  finishVersion,
  landingStats,
  HttpError,
  ipHash,
  ledgerVault,
  loadConfig,
  markBatchSent,
  openDispute,
  disputeTx,
  proposePayouts,
  quoteListing,
  recordChainBalance,
  releaseOrders,
  resolveDispute,
  reviewVersion,
  sha256Hex,
  storeSandbox,
  tierForWallet,
  watermarked,
  type Deps,
} from './logic';
import { orderEscrow, recentEscrows, scanReport, transparency } from './transparency';
import {
  HttpDataError,
  assertSupplementPaid,
  consumeVerification,
  createRenewal,
  createVerifySupplement,
  createVersionRow,
  orderUpdates,
  pickDownload,
  renewalQuoteFor,
  settleRenewal,
  settleSupplement,
  suggestedUpdatePrice,
  supplementState,
  uploadQuota,
  verifyQuota,
} from './versioning';

/** Session lifetime; refreshed (no new signature) once it is a day old. */
export const SESSION_TTL_S = 30 * 24 * 3600;
const SESSION_REFRESH_AFTER_S = 24 * 3600;

type Vars = { user: Record<string, any> | null; apiKey: ApiKeyContext | null };
/** Expiry (unix seconds) of the session cookie that authenticated each request. */
const sessionExpiry = new WeakMap<Request, number>();
type App = Hono<{ Variables: Vars }>;

async function bodyOf<T>(schema: z.ZodType<T>, raw: unknown): Promise<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, 'BAD_REQUEST', issue?.message ?? 'invalid body');
  }
  return parsed.data;
}

/** Postgres undefined_column (42703) or undefined_table (42P01): the schema is behind the code. */
export function isSchemaMismatch(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === '42703' || code === '42P01';
}

function requireUser(c: { get: (key: 'user') => Record<string, any> | null }): Record<string, any> {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'sign in required');
  if (user.banned_at) throw new HttpError(403, 'BANNED', 'this wallet is banned');
  return user;
}

function requireRole(user: Record<string, any>, role: string): void {
  const roles = user.roles as string[];
  if (!roles?.includes(role) && !roles?.includes('admin')) {
    throw new HttpError(403, 'FORBIDDEN', `${role} role required`);
  }
}

export type PriceCacheBox = { value: PriceCache };

// The Worker builds one app per request (a postgres.js client cannot be shared across
// requests in workerd), so it passes a module-level box to keep the SOL price cache warm.
/** Listing links may carry the id instead of the slug; both resolve to the same page. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp(deps: Deps, priceCache: PriceCacheBox = { value: null }): App {
  async function solPrice() {
    const quote = await cachedSolUsd({
      nowMs: deps.now().getTime(),
      cache: priceCache.value,
      override: deps.env.solUsdOverride,
      fetchUsd: deps.env.solUsdOverride ? undefined : () => fetchSolUsd(),
    });
    priceCache.value = quote.cache;
    return quote;
  }

  // Error events feed the ops check (5xx spike, webhook and scan pipeline failures).
  const recordErrorEvent = async (path: string, err: unknown) => {
    const detail = `${path}: ${(err as Error)?.message ?? String(err)}`;
    await recordOpsEvent(deps, '5xx', detail);
    if (path.includes('/hooks/')) await recordOpsEvent(deps, 'webhook_error', detail);
    if (/\/(versions\/[^/]+\/(complete|explain|reupload)|internal\/sandbox)/.test(path))
      await recordOpsEvent(deps, 'scan_error', detail);
  };
  const app = new Hono<{ Variables: Vars }>();
  app.onError((err, c) => {
    if (err instanceof HttpDataError) {
      return c.json(
        jsonSafe({ error: { code: err.code, message: err.message, ...err.data } }),
        err.status as 400,
      );
    }
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    if (err instanceof EscrowError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    if (err instanceof BlobUnavailableError) {
      void recordOpsEvent(deps, 'r2_error', `${c.req.path}: ${err.message}`);
      return c.json({ error: { code: 'STORAGE_UNAVAILABLE', message: err.message } }, 503);
    }
    console.error(err);
    void recordErrorEvent(c.req.path, err);
    if (isSchemaMismatch(err)) {
      // undefined_column / undefined_table: this release needs a migration the DB lacks.
      console.error(
        'ALERT',
        JSON.stringify({
          level: 'critical',
          code: 'SCHEMA_BEHIND',
          message: `${c.req.path}: ${(err as Error).message}`,
        }),
      );
      return c.json(
        {
          error: { code: 'SCHEMA_BEHIND', message: 'Service is being updated, try again shortly' },
        },
        503,
      );
    }
    return c.json({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500);
  });
  // Security headers on every API response (mainnet readiness #11).
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Served files carry their own stricter policy (default-src 'none'; sandbox).
    if (!c.res.headers.get('content-security-policy'))
      c.header('Content-Security-Policy', "frame-ancestors 'none'");
    c.header('Referrer-Policy', 'no-referrer');
  });
  app.use(
    '*',
    cors({
      origin: deps.env.appUrl,
      credentials: true,
      allowHeaders: ['content-type', 'authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use('*', async (c, next) => {
    const token = getCookie(c, 'tm_session');
    c.set('user', null);
    c.set('apiKey', null);
    const authorization = c.req.header('authorization');
    if (isApiKeyHeader(authorization) && c.req.path.startsWith('/api/v1/')) {
      // Agent API key: the cookie is ignored, scopes are enforced deny-by-default, and every
      // request (reads included) counts against the key's own per-minute limit.
      const rule = scopeFor(c.req.method, c.req.path.slice('/api/v1'.length));
      if (rule === 'denied')
        return c.json(
          { error: { code: 'KEY_FORBIDDEN', message: 'this route is not available to API keys' } },
          403,
        );
      const authed = await authenticateApiKey(deps, authorization as string);
      if (authed.user.banned_at)
        return c.json({ error: { code: 'BANNED', message: 'this wallet is banned' } }, 403);
      if (rule !== 'open' && !rule.anyOf.some((scope) => authed.key.scopes.includes(scope)))
        return c.json(
          {
            error: {
              code: 'INSUFFICIENT_SCOPE',
              message: `this key needs the ${rule.anyOf.join(' or ')} scope`,
            },
          },
          403,
        );
      const budget = await consumeKeyRate(deps, authed.key);
      c.header('X-RateLimit-Limit', String(authed.key.rateLimitPerMin));
      c.header('X-RateLimit-Remaining', String(budget.remaining));
      c.header('X-RateLimit-Reset', String(budget.resetSec));
      if (!budget.ok) {
        c.header('Retry-After', String(budget.resetSec));
        return c.json(
          { error: { code: 'RATE_LIMIT', message: 'API key rate limit exceeded' } },
          429,
        );
      }
      c.set('user', authed.user);
      c.set('apiKey', authed.key);
    } else if (token) {
      const payload = await verifyJwt<{ sub?: string; exp?: number }>(
        token,
        deps.env.sessionSecret,
        deps.now().getTime(),
      );
      if (payload?.sub) {
        const rows = await deps.sql<
          Record<string, any>[]
        >`select * from users where id = ${payload.sub}`;
        if (rows[0]) {
          c.set('user', rows[0]);
          if (typeof payload.exp === 'number') sessionExpiry.set(c.req.raw, payload.exp);
        }
      }
    }
    const path = c.req.path;
    const write = c.req.method !== 'GET' && c.req.method !== 'OPTIONS' && !path.endsWith('/health');
    if (write) {
      // M-03: keyed on the edge-provided client IP, never on X-Forwarded-For.
      const ip = clientIp(c, deps.env);
      const key = `${ip}:${c.req.method}`;
      if (deps.rateLimiter) {
        const { success } = await deps.rateLimiter.limit({ key });
        if (!success)
          return c.json({ error: { code: 'RATE_LIMIT', message: 'too many requests' } }, 429);
        await next();
        return;
      }
      const now = deps.now();
      const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
      const hits = await deps.sql<{ hits: number }[]>`
        insert into rate_buckets (key, window_start, hits) values (${key}, ${windowStart}, 1)
        on conflict (key, window_start) do update set hits = rate_buckets.hits + 1
        returning hits
      `;
      if ((hits[0]?.hits ?? 1) > deps.env.rateLimitPerMin) {
        return c.json({ error: { code: 'RATE_LIMIT', message: 'too many requests' } }, 429);
      }
    }
    await next();
  });

  const api = new Hono<{ Variables: Vars }>();
  // Also the release-vs-schema check: a Worker deployed ahead of its migrations answers 503
  // here, so the health-check workflow and the watchdog alert. One tiny read of
  // schema_migrations (Hyperdrive caches it); a DB outage is DB_ERROR in the ops check instead.
  api.get('/health', async (c) => {
    const pending = await pendingMigrations(deps.sql).catch(() => [] as string[]);
    if (pending.length > 0)
      return c.json({ ok: false, cluster: deps.env.cluster, code: 'SCHEMA_BEHIND', pending }, 503);
    return c.json({ ok: true, cluster: deps.env.cluster });
  });
  api.get('/openapi.json', (c) => {
    c.header('access-control-allow-origin', '*');
    return c.json(openApiSpec({ apiUrl: deps.env.apiUrl, cluster: deps.env.cluster }));
  });
  // Agent API: wallet-signed key minting, key management, validated broadcast, release.
  registerAgentRoutes(api, deps);

  api.post('/tx/send', async (c) => {
    requireUser(c);
    const body = await bodyOf(txBroadcastBody, await c.req.json());
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(body.txBase64);
    } catch {
      throw new HttpError(400, 'BAD_TX', 'transaction is not base64');
    }
    if (bytes.length < 64) throw new HttpError(400, 'BAD_TX', 'transaction is too short');
    try {
      const signature = await sendRaw(deps.env.rpcUrl, bytes);
      return c.json({ signature });
    } catch (err) {
      throw new HttpError(502, 'RPC', err instanceof Error ? err.message : 'broadcast failed');
    }
  });

  api.get('/files', async (c) => serveFile(c, deps, 'GET'));
  api.put('/files', async (c) => serveFile(c, deps, 'PUT'));

  async function issueSession(c: Parameters<typeof setCookie>[0], userId: string): Promise<number> {
    const exp = Math.floor(deps.now().getTime() / 1000) + SESSION_TTL_S;
    const token = await signJwt({ sub: userId, exp }, deps.env.sessionSecret);
    setCookie(c, 'tm_session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_S,
    });
    return exp;
  }

  function sessionInfo(exp: number) {
    const expiresAt = new Date(exp * 1000).toISOString();
    const refreshAfter = new Date((exp - SESSION_TTL_S + SESSION_REFRESH_AFTER_S) * 1000);
    return { expiresAt, refreshAfter: refreshAfter.toISOString() };
  }

  api.post('/auth/nonce', async (c) => {
    const body = await bodyOf(nonceBody, await c.req.json());
    const nonce = randomNonce();
    const issued = deps.now();
    const expires = siwsExpiresAt(issued);
    await deps.sql`
      insert into auth_nonces (nonce, wallet, expires_at) values (${nonce}, ${body.wallet}, ${expires})
    `;
    const message = buildSiwsMessage({
      domain: deps.env.siwsDomain,
      wallet: body.wallet,
      nonce,
      issuedAt: issued,
      uri: deps.env.siwsUri,
    });
    return c.json({ nonce, message });
  });

  api.post('/auth/verify', async (c) => {
    const body = await bodyOf(verifyBody, await c.req.json());
    const nonces = await deps.sql<Record<string, any>[]>`
      select * from auth_nonces where wallet = ${body.wallet} and used_at is null and expires_at > ${deps.now()}
      order by expires_at desc limit 5
    `;
    let matched: Record<string, any> | null = null;
    for (const nonce of nonces) {
      const issued = new Date((nonce.expires_at as Date).getTime() - 10 * 60 * 1000);
      const message = buildSiwsMessage({
        domain: deps.env.siwsDomain,
        wallet: body.wallet,
        nonce: nonce.nonce as string,
        issuedAt: issued,
        uri: deps.env.siwsUri,
      });
      if (verifySiwsSignature(message, body.signature, body.wallet)) {
        matched = nonce;
        break;
      }
    }
    if (!matched)
      throw new HttpError(401, 'BAD_SIGNATURE', 'signature does not match an open nonce');
    // The signature is valid: consume the nonce, look up the user and take the first
    // balance snapshot in one round trip instead of three (sign-in waited ~3 s).
    const [used, existing] = await Promise.all([
      deps.sql`
        update auth_nonces set used_at = ${deps.now()} where nonce = ${matched.nonce} and used_at is null returning nonce
      `,
      deps.sql<Record<string, any>[]>`select * from users where wallet = ${body.wallet}`,
      ensureSnapshot(deps, body.wallet),
    ]);
    if (used.length === 0) throw new HttpError(401, 'NONCE_USED', 'nonce already used');
    let users = existing;
    if (!users[0]) {
      users = await deps.sql<Record<string, any>[]>`
        insert into users (wallet, roles) values (${body.wallet}, ${deps.sql.array(['buyer'])}::user_role[]) returning *
      `;
    }
    const user = users[0];
    if (!user) throw new HttpError(500, 'INTERNAL', 'could not create user');
    const exp = await issueSession(c, user.id as string);
    return c.json(jsonSafe({ user: publicUser(user), session: sessionInfo(exp) }));
  });

  // Idempotent: an expired or missing session still gets its cookie cleared, so the
  // browser never stays half signed in because logout answered 401.
  api.post('/auth/logout', (c) => {
    setCookie(c, 'tm_session', '', { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 });
    return c.body(null, 204);
  });

  // One signature per session: a live session slides forward without a new wallet prompt.
  api.post('/auth/refresh', async (c) => {
    const user = requireUser(c);
    const exp = await issueSession(c, user.id as string);
    return c.json(jsonSafe({ user: publicUser(user), session: sessionInfo(exp) }));
  });

  api.get('/auth/session', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ user: null, session: null });
    const exp = sessionExpiry.get(c.req.raw) ?? 0;
    return c.json(jsonSafe({ user: publicUser(user), session: sessionInfo(exp) }));
  });

  api.get('/me', async (c) => {
    const user = requireUser(c);
    const config = await loadConfig(deps);
    const tier = await tierForWallet(deps, user.wallet as string, config, { reconcile: false });
    return c.json(
      jsonSafe({
        user: publicUser(user),
        roles: user.roles,
        tier: tier.tier,
        session: sessionExpiry.has(c.req.raw) ? sessionInfo(sessionExpiry.get(c.req.raw)!) : null,
        tierDetail: {
          minBalance: tier.minBalance,
          windowHours: config.tier_window_hours,
          nextTier: tier.nextTier,
          needed: tier.needed,
        },
      }),
    );
  });

  // M-04: X OAuth 2.0 + PKCE. The callback runs on the web origin (through the /api/v1
  // proxy) so the session cookie comes along.
  const xRedirectUri = () => `${deps.env.appUrl}/api/v1/auth/x/callback`;
  api.get('/auth/x/start', (c) => {
    const user = requireUser(c);
    if (!deps.env.xClientId)
      throw new HttpError(
        501,
        'X_UNCONFIGURED',
        'X OAuth is not configured. Use the dev handle link.',
      );
    const started = startXAuth({
      clientId: deps.env.xClientId,
      redirectUri: xRedirectUri(),
      userId: user.id as string,
      secret: deps.env.sessionSecret,
      now: deps.now(),
    });
    setCookie(c, X_COOKIE, started.cookie, {
      httpOnly: true,
      secure: deps.env.appUrl.startsWith('https://'),
      sameSite: 'Lax',
      path: '/api/v1/auth/x',
      maxAge: 600,
    });
    return c.json({ url: started.url });
  });

  api.get('/auth/x/callback', async (c) => {
    // Every outcome lands on the profile editor, whose X card says what happened and why.
    const done = (result: string, reason?: string) =>
      c.redirect(
        `${deps.env.appUrl}/studio/profile?x=${result}${reason ? `&reason=${reason}` : ''}`,
        302,
      );
    setCookie(c, X_COOKIE, '', {
      httpOnly: true,
      secure: deps.env.appUrl.startsWith('https://'),
      sameSite: 'Lax',
      path: '/api/v1/auth/x',
      maxAge: 0,
    });
    // A top-level redirect from X: answer with a page the creator can read, not a JSON 401.
    const user = c.get('user');
    if (!user) {
      console.error('x oauth failed', 'signed_out', 'no session cookie on the callback');
      return done('failed', 'signed_out');
    }
    if (!deps.env.xClientId) return done('unconfigured');
    if (c.req.query('error')) return done('denied');
    const checked = checkXState({
      cookie: getCookie(c, X_COOKIE),
      state: c.req.query('state'),
      userId: user.id as string,
      secret: deps.env.sessionSecret,
      now: deps.now(),
    });
    if (!checked.ok) {
      console.error('x oauth failed', checked.reason);
      return done('invalid', checked.reason);
    }
    const code = c.req.query('code');
    if (!code) return done('invalid', 'no_code');
    let account: { id: string; username: string };
    try {
      account = await fetchXAccount({
        fetch: deps.xFetch,
        apiUrl: deps.env.xApiUrl,
        clientId: deps.env.xClientId,
        clientSecret: deps.env.xClientSecret,
        redirectUri: xRedirectUri(),
        code,
        verifier: checked.verifier,
      });
    } catch (err) {
      const reason = err instanceof XAuthError ? err.reason : 'unexpected';
      console.error('x oauth failed', reason, (err as Error).message);
      return done('failed', reason);
    }
    const taken = await deps.sql`
      select 1 from users where x_user_id = ${account.id} and id <> ${user.id}
    `;
    if (taken.length > 0) return done('taken');
    // A dev-linked (unverified) claim on this handle by someone else is released.
    await deps.sql`
      update users set x_handle = null, x_user_id = null
      where lower(x_handle) = lower(${account.username}) and id <> ${user.id} and x_user_id like 'dev:%'
    `;
    await deps.sql`update users set x_handle = ${account.username}, x_user_id = ${account.id} where id = ${user.id}`;
    await audit(deps.sql, user.id as string, 'user', user.id as string, 'x_linked', {
      xUserId: account.id,
      handle: account.username,
    });
    console.log('x oauth linked', user.id, account.username);
    return done('linked');
  });

  api.post('/studio/x', async (c) => {
    const user = requireUser(c);
    // Unverified dev link (test clusters only by construction): disabled once X OAuth is set.
    if (deps.env.xClientId)
      throw new HttpError(410, 'X_OAUTH_REQUIRED', 'link X with the Connect X button');
    const body = await bodyOf(devLinkBody, await c.req.json());
    await deps.sql`update users set x_handle = ${body.handle}, x_user_id = ${'dev:' + body.handle} where id = ${user.id}`;
    return c.json({ handle: body.handle });
  });

  // Creator profile (studio redesign): editable fields, avatar and banner.
  api.get('/studio/profile', async (c) => {
    const user = requireUser(c);
    return c.json(
      jsonSafe({
        ...(await loadOwnProfile(deps, user.id as string)),
        // What this deployment can do, so the editor never offers a flow that would fail.
        // xOAuth: "Verify with X" works (X_CLIENT_ID is set). Without it the button is shown
        // as unavailable and /auth/x/start answers 501 X_UNCONFIGURED.
        capabilities: { xOAuth: Boolean(deps.env.xClientId) },
      }),
    );
  });

  api.put('/studio/profile', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await saveProfile(deps, user.id as string, await c.req.json())));
  });

  for (const kind of ['avatar', 'banner'] as const) {
    api.post(`/studio/profile/${kind}`, async (c) => {
      const user = requireUser(c);
      const declared = Number(c.req.header('content-length') ?? '0');
      if (declared > IMAGE_MAX_BYTES) {
        throw new HttpError(413, 'IMAGE_TOO_LARGE', 'images are limited to 3 MB');
      }
      const bytes = await readCapped(c.req.raw.body, IMAGE_MAX_BYTES);
      return c.json(await uploadProfileImage(deps, user.id as string, kind, bytes));
    });
    api.delete(`/studio/profile/${kind}`, async (c) => {
      const user = requireUser(c);
      await removeProfileImage(deps, user.id as string, kind);
      return c.json({ ok: true });
    });
  }

  api.get('/categories', async (c) => {
    const counts = await deps.sql<{ category: string; count: number }[]>`
      select category, count(*)::int as count from listings
      where delisted_at is null and paused_at is null and live_version_id is not null
      group by category
    `;
    const byCategory = new Map(counts.map((row) => [row.category, row.count]));
    return c.json(
      CATEGORIES.map((category) => ({ ...category, count: byCategory.get(category.code) ?? 0 })),
    );
  });

  api.get('/config/public', async (c) => {
    const config = await loadConfig(deps);
    return c.json(
      jsonSafe({
        feeBps: config.fee_bps,
        tierRebateBps: config.tier_rebate_bps,
        tierThresholds: config.tier_thresholds_raw,
        tierWindowHours: config.tier_window_hours,
        feeSplitBps: config.fee_split_bps,
        escrowHours: config.escrow_hours,
        verificationFeeLamports: config.verification_fee_lamports,
        bondLamportsByCategory: config.bond_lamports_by_category,
        terminals: config.terminals,
        updateFreeDays: config.update_free_days,
        updatePeriodDays: config.update_period_days,
        updatePriceDefaultBps: config.update_price_default_bps,
        updateLimitPerListingDay: config.update_limit_per_listing_day,
        uploadLimitPerCreatorDay: config.upload_limit_per_creator_day,
        uploadSupplementLamports: config.upload_supplement_lamports,
        verifyFreePerDay: config.verify_free_per_day,
        verifySupplementLamports: config.verify_supplement_lamports,
      }),
    );
  });

  api.get('/listings', async (c) => {
    const query = await bodyOf(listingsQuery, c.req.query());
    const config = await loadConfig(deps);
    const user = c.get('user');
    const tier = user ? (await tierForWallet(deps, user.wallet as string, config)).tier : 'none';
    return c.json(jsonSafe(await searchListings(deps, query, tier)));
  });

  api.get('/listings/:slug', async (c) => {
    const slug = c.req.param('slug');
    const rows = await deps.sql<Record<string, any>[]>`
      select l.*, u.handle, u.wallet as creator_wallet, u.x_handle, u.x_user_id
      from listings l join users u on u.id = l.creator_id
      where l.slug = ${slug} or (${UUID_RE.test(slug)} and l.id::text = ${slug.toLowerCase()})
      limit 1
    `;
    const listing = rows[0];
    if (!listing) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
    const security = listing.live_version_id
      ? await securityBlock(deps, listing.live_version_id as string)
      : null;
    const bond = await activeBond(deps.sql, listing.creator_id as string);
    return c.json(
      jsonSafe({
        ...publicListing(listing),
        creator: creatorCard(listing, bond),
        security,
        // Wallet lists: unique Solana addresses the scan counted in the live version's file.
        walletCount: security?.walletCount ?? null,
        preview: await previewOf(deps, security?.r2Key),
        content: await publicContent(deps, listing.id as string),
      }),
    );
  });

  // Seller images. Public once they are on an approved page; the owner can preview drafts.
  api.get('/media/:id', async (c) => {
    const user = c.get('user');
    const w = Number(c.req.query('w'));
    return mediaResponse(
      deps,
      c.req.param('id'),
      (user?.id as string | undefined) ?? null,
      Number.isInteger(w) ? w : null,
    );
  });

  api.get('/listings/:slug/versions', async (c) => {
    const rows = await deps.sql<Record<string, any>[]>`
      select v.semver, v.changelog, v.created_at, v.status, v.wallet_count as "walletCount" from versions v
      join listings l on l.id = v.listing_id
      where l.slug = ${c.req.param('slug')} and v.status in ('live', 'superseded')
      order by v.created_at desc
    `;
    return c.json(jsonSafe(rows));
  });

  // Reviews, creator replies, helpful votes, reports, moderation (reviews.ts).
  // The social modules type their context with `user` only; apiKey is an extra variable.
  const socialApi = api as unknown as Parameters<typeof registerReviewRoutes>[0];
  registerReviewRoutes(socialApi, deps);
  // Weighted listing upvotes (ranking.ts).
  registerUpvoteRoutes(socialApi, deps);
  // Creator leaderboard and the live activity feed (leaderboard.ts); before /creators/:handle.
  registerLeaderboardRoutes(socialApi, deps);
  // Paid featuring: booking, payment, refunds, admin (featuring.ts).
  registerFeaturingRoutes(
    socialApi as unknown as Parameters<typeof registerFeaturingRoutes>[0],
    deps,
    (ids) => searchListings(deps, { ids, limit: 50 }, 'none'),
  );

  // Today's "Featured · Sponsored" listings for a placement, in hourly rotation.
  api.get('/featured', async (c) => {
    const placement = c.req.query('placement') === 'category' ? 'category' : 'home';
    const category = c.req.query('category') ?? null;
    if (placement === 'category' && !category)
      throw new HttpError(400, 'BAD_REQUEST', 'category required');
    const slots = await featuredToday(deps, placement, category);
    if (slots.length === 0) return c.json({ placement, items: [] });
    const cards = await searchListings(
      deps,
      { ids: slots.map((s) => s.listingId), limit: 50 },
      'none',
    );
    const items = slots.flatMap((slot) => {
      const card = cards.find((row) => row.id === slot.listingId);
      return card ? [{ ...card, sponsored: { bookingId: slot.bookingId, placement } }] : [];
    });
    return c.json(jsonSafe({ placement, items }));
  });

  api.get('/creators/top', async (c) => {
    const rows = await deps.sql<Record<string, any>[]>`
      select u.handle, u.wallet, coalesce(sum(o.price), 0)::bigint as volume, count(distinct l.id)::int as listings
      from users u
      join listings l on l.creator_id = u.id and l.delisted_at is null
      left join orders o on o.listing_id = l.id and o.status in ('paid', 'released') and o.paid_at > now() - interval '30 days'
      group by u.id
      order by volume desc
      limit 10
    `;
    return c.json(jsonSafe(rows));
  });

  api.get('/creators/:handle', async (c) => {
    const creator = await findCreator(deps, c.req.param('handle'));
    if (!creator) throw new HttpError(404, 'NOT_FOUND', 'creator not found');
    const listings = await deps.sql<Record<string, any>[]>`
      select l.*, u.handle from listings l join users u on u.id = l.creator_id
      where l.creator_id = ${creator.id} and l.delisted_at is null and l.paused_at is null
        and l.live_version_id is not null
      order by l.created_at desc
    `;
    const viewer = c.get('user');
    const profile = await publicProfile(deps, creator, (viewer?.id as string | undefined) ?? null);
    return c.json(
      jsonSafe({ ...profile, listings: listings.map((listing) => publicListing(listing)) }),
    );
  });

  api.get('/profile-media/:id', (c) => profileMediaResponse(deps, c.req.param('id')));

  api.post('/orders/quote', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(quoteBody, await c.req.json());
    const quote = await quoteListing(deps, user.id as string, body.listingId);
    const price = await solPrice();
    return c.json(
      jsonSafe({
        price: quote.price,
        fee: quote.fee,
        rebate: quote.rebate,
        total: quote.total,
        tier: quote.tier,
        feeBps: quote.feeBps,
        rebateBps: quote.rebateBps,
        solUsd: { centsPerSol: price.centsPerSol, source: price.source },
        totalUsd: moneyView(quote.total, price.centsPerSol, formatSol(quote.total)),
      }),
    );
  });

  api.post('/orders', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(orderBody, await c.req.json());
    return c.json(jsonSafe(await createOrder(deps, user.id as string, body.listingId)));
  });

  api.post('/orders/:id/submitted', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(submittedBody, await c.req.json());
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    const result = await applyPayment(deps, {
      kind: 'order',
      id: order.id as string,
      txSig: body.txSig,
      actorId: user.id as string,
    });
    if (!result.ok) throw new HttpError(400, result.code, result.message);
    return c.json({ ok: true });
  });

  api.get('/transparency', async (c) => {
    const [state, escrows] = await Promise.all([transparency(deps), recentEscrows(deps)]);
    return c.json(jsonSafe({ ...(state as object), recentEscrows: escrows }));
  });

  api.get('/listings/:slug/report', async (c) => {
    const signed = await scanReport(deps, c.req.param('slug'));
    if (c.req.query('download') === '1') {
      c.header(
        'content-disposition',
        `attachment; filename="trenchmart-report-${c.req.param('slug')}-${signed.report.version.semver}.json"`,
      );
    }
    return c.json(jsonSafe(signed));
  });

  api.get('/orders/:id/escrow', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await orderEscrow(deps, c.req.param('id'), user.id as string)));
  });

  api.get('/orders/:id', async (c) => {
    const user = requireUser(c);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    return c.json(jsonSafe(order));
  });

  api.get('/me/orders', async (c) => {
    const user = requireUser(c);
    const rows = await deps.sql<Record<string, any>[]>`
      select o.*, l.slug, l.title,
        coalesce(c.live->>'coverImageId', c.live->'gallery'->0->>'imageId') as cover_image_id
      from orders o join listings l on l.id = o.listing_id
      left join listing_content c on c.listing_id = l.id
      where o.buyer_id = ${user.id} order by o.created_at desc
    `;
    const price = await solPrice();
    const config = await loadConfig(deps);
    const owned = rows.filter((row) => ['paid', 'released', 'disputed'].includes(row.status));
    const tier = owned.length
      ? (await tierForWallet(deps, user.wallet as string, config)).tier
      : ('none' as const);
    const rebateBps = config.tier_rebate_bps[tier];
    const updates = new Map<string, unknown>();
    for (const row of owned) {
      const info = await orderUpdates(deps, row, config);
      const fee = (info.updatePrice * BigInt(config.fee_bps)) / 10_000n;
      const rebate = (fee * BigInt(rebateBps)) / 10_000n;
      const { versions, ...rest } = info;
      updates.set(row.id as string, {
        ...rest,
        renewTotal: info.updatePrice + fee - rebate,
        versions: versions
          .filter((v) => v.entitled)
          .map((v) => ({ id: v.id, semver: v.semver, purchased: v.purchased })),
      });
    }
    return c.json(
      jsonSafe({
        solUsd: { centsPerSol: price.centsPerSol, source: price.source },
        orders: rows.map(({ cover_image_id: coverId, ...order }) => ({
          ...order,
          updates: updates.get(order.id as string) ?? null,
          cover: coverId ? { url: mediaUrl(coverId as string), alt: '' } : null,
          amount: moneyView(
            order.total as bigint,
            price.centsPerSol,
            formatSol(order.total as bigint),
          ),
        })),
      }),
    );
  });

  api.post('/orders/:id/download', async (c) => {
    const user = requireUser(c);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    // Payment confirmed in escrow is enough to download. The funds stay locked until the
    // escrow window ends, so a buyer can still dispute; a disputed order cannot download.
    if (order.status !== 'paid' && order.status !== 'released') {
      throw new HttpError(
        403,
        'ESCROW_LOCKED',
        order.status === 'disputed'
          ? 'downloads are paused while the dispute is open'
          : 'downloads unlock once payment is confirmed in escrow',
      );
    }
    const license =
      await deps.sql`select 1 from licenses where order_id = ${order.id} and wallet = ${user.wallet}`;
    if (license.length === 0) throw new HttpError(403, 'NO_LICENSE', 'no license for this wallet');
    // Latest entitled version by default; a specific entitled version (for example the exact
    // one purchased) when asked. A version released after updates lapsed is refused.
    const text = await c.req.text().catch(() => '');
    let asked: string | undefined = c.req.query('version') || undefined;
    if (!asked && text) {
      try {
        const parsed = JSON.parse(text) as { versionId?: unknown };
        if (typeof parsed.versionId === 'string') asked = parsed.versionId;
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'invalid body');
      }
    }
    const entitlement = await orderUpdates(deps, order);
    const versionId = pickDownload(entitlement, asked);
    const versions = await deps.sql<
      Record<string, any>[]
    >`select * from versions where id = ${versionId}`;
    const version = versions[0];
    if (!version) throw new HttpError(404, 'NOT_FOUND', 'version missing');
    const original = await deps.blob.get(version.r2_key as string);
    if (!original) throw new HttpError(404, 'FILE_MISSING', 'file missing');
    const bytes = await watermarked(
      original,
      version.file_name as string,
      order.id as string,
      user.wallet as string,
      version.sha256 as string,
    );
    const key = `licensed/${order.id}/${version.id}/${version.file_name}`;
    await deps.blob.put(key, bytes);
    const exp = Math.floor(deps.now().getTime() / 1000) + 300;
    await deps.sql`
      insert into downloads (order_id, version_id, ip_hash)
      values (${order.id}, ${version.id}, ${ipHash(clientIp(c, deps.env), deps.env.sessionSecret)})
    `;
    return c.json({
      url: deps.blob.signedGet(key, exp),
      expiresAt: new Date(exp * 1000).toISOString(),
      versionId: version.id,
      semver: version.semver,
    });
  });

  api.get('/orders/:id/versions', async (c) => {
    const user = requireUser(c);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    return c.json(jsonSafe(await orderUpdates(deps, order)));
  });

  api.post('/orders/:id/updates/quote', async (c) => {
    const user = requireUser(c);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    const q = await renewalQuoteFor(deps, order, user.wallet as string);
    const price = await solPrice();
    return c.json(
      jsonSafe({
        price: q.price,
        fee: q.fee,
        rebate: q.rebate,
        total: q.total,
        tier: q.tier,
        feeBps: q.feeBps,
        rebateBps: q.rebateBps,
        startsAt: q.startsAt,
        endsAt: q.endsAt,
        periodDays: q.periodDays,
        totalUsd: moneyView(q.total, price.centsPerSol, formatSol(q.total)),
      }),
    );
  });

  api.post('/orders/:id/updates/renew', async (c) => {
    const user = requireUser(c);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    return c.json(jsonSafe(await createRenewal(deps, order, user)));
  });

  api.post('/orders/:id/updates/:renewalId/submitted', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(submittedBody, await c.req.json());
    await ownOrder(deps, c.req.param('id'), user.id as string);
    const result = await settleRenewal(deps, c.req.param('renewalId'), user, body.txSig);
    if (!result.ok) throw new HttpError(400, result.code, result.message);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    return c.json(jsonSafe({ ok: true, updatesUntil: order.updates_until }));
  });

  api.post('/orders/:id/dispute', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(disputeBody, await c.req.json());
    const opened = await openDispute(
      deps,
      c.req.param('id'),
      user.id as string,
      body.reason,
      body.details,
    );
    return c.json({ disputeId: opened.id, txBase64: opened.txBase64 });
  });

  api.post('/orders/:id/dispute/tx', async (c) => {
    const user = requireUser(c);
    return c.json(await disputeTx(deps, c.req.param('id'), user.id as string));
  });

  api.post('/listings/:slug/report', async (c) => {
    const body = await bodyOf(reportBody, await c.req.json());
    const user = c.get('user');
    const listing = await deps.sql<
      { id: string }[]
    >`select id from listings where slug = ${c.req.param('slug')}`;
    const id = listing[0]?.id;
    if (!id) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
    await deps.sql`insert into reports (listing_id, reporter_id, details) values (${id}, ${user?.id ?? null}, ${body.details})`;
    return c.json({ ok: true });
  });

  // Standalone file verification: one free check per wallet and network per UTC day, then a
  // SOL supplement. Anonymous use cannot be limited reliably (addresses rotate), so a wallet
  // sign-in is required.
  api.get('/verify/quota', async (c) => {
    const user = c.get('user');
    return c.json(jsonSafe(await verifyQuota(deps, user, clientIpHash(c, deps))));
  });

  api.post('/verify', async (c) => {
    const user = c.get('user');
    if (!user) {
      throw new HttpError(401, 'SIGN_IN_REQUIRED', 'sign in with a wallet to verify a file');
    }
    requireUser(c);
    const body = await bodyOf(verifyJsonBody, await c.req.json());
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(body.contentBase64), (char) => char.charCodeAt(0));
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'file is not base64');
    }
    const used = await consumeVerification(deps, user, clientIpHash(c, deps), body.supplementId);
    return c.json({ ...(await matchFile(deps, body.fileName, bytes)), free: used.free });
  });

  api.post('/verify/supplement', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await createVerifySupplement(deps, user)));
  });

  api.post('/supplements/:id/submitted', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(submittedBody, await c.req.json());
    const result = await settleSupplement(deps, c.req.param('id'), user.id as string, body.txSig);
    if (!result.ok) throw new HttpError(400, result.code, result.message);
    return c.json({ ok: true });
  });

  api.get('/studio/requirements', async (c) => {
    const user = requireUser(c);
    const configQ = loadConfig(deps);
    const [config, categories, bond] = await Promise.all([
      configQ,
      deps.sql<{ category: string }[]>`
        select distinct category from listings where creator_id = ${user.id} and delisted_at is null and live_version_id is not null
      `,
      activeBond(deps.sql, user.id as string),
    ]);
    const tier = await tierForWallet(deps, user.wallet as string, config);
    const required = bondToList(
      categories.map((row) => row.category),
      config.bond_lamports_by_category,
      tier.tier,
      config.og_bond_discount_bps,
    );
    return c.json(
      jsonSafe({
        creator: ((user.roles as string[] | undefined) ?? []).includes('creator'),
        walletSigned: true,
        // Once X OAuth is configured, only a verified link counts: dev links must re-verify.
        xLinked: deps.env.xClientId ? xVerified(user) : Boolean(user.x_handle),
        bondRequired: required,
        bondActive: bond,
        bondOk: bond >= required,
        verificationFee: config.verification_fee_lamports,
        feeWaived: tierAtLeast(tier.tier, config.verification_fee_free_from_tier),
        bondByCategory: config.bond_lamports_by_category,
      }),
    );
  });

  api.post('/studio/bond', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(bondBody, await c.req.json());
    const amount = BigInt(body.amount);
    if (amount < 1_000_000_000n || amount > 5_000_000_000n) {
      throw new HttpError(400, 'BOND_RANGE', 'bond must be between 1 and 5 SOL');
    }
    // Build the transaction first: if the RPC or blockhash fails, no pending row is left behind.
    const id = crypto.randomUUID();
    const tx = await buildVaultTx(deps, user.wallet as string, amount, bondMemo(id));
    await deps.sql`
      insert into bonds (id, user_id, amount, tx_sig, status)
      values (${id}, ${user.id}, ${amount}, ${'pending-' + id}, 'pending')
    `;
    return c.json(jsonSafe({ bondId: id, memo: bondMemo(id), amount, ...tx }));
  });

  api.post('/studio/bond/:id/submitted', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(submittedBody, await c.req.json());
    const bond =
      await deps.sql`select id from bonds where id = ${c.req.param('id')} and user_id = ${user.id}`;
    if (bond.length === 0) throw new HttpError(404, 'NOT_FOUND', 'bond not found');
    const result = await applyPayment(deps, {
      kind: 'bond',
      id: c.req.param('id'),
      txSig: body.txSig,
      actorId: user.id as string,
    });
    if (!result.ok) throw new HttpError(400, result.code, result.message);
    return c.json({ ok: true });
  });

  api.post('/studio/listings', async (c) => {
    const user = requireUser(c);
    if (deps.env.xClientId ? !xVerified(user) : !user.x_handle)
      throw new HttpError(400, 'X_REQUIRED', 'link and verify your X account first');
    const body = await bodyOf(listingBody, await c.req.json());
    // The category bond is the gate (docs/06-payments-escrow.md). Meeting it makes the
    // wallet a creator, so a creator is never blocked by a role it cannot request.
    await assertBond(deps, user, body.category);
    await grantCreatorRole(deps.sql, user.id as string);
    const slug = await uniqueSlug(deps, body.title);
    const updatePrice =
      body.updatePriceLamports !== undefined
        ? BigInt(body.updatePriceLamports)
        : suggestedUpdatePrice(BigInt(body.priceLamports), await loadConfig(deps));
    const inserted = await deps.sql<{ id: string }[]>`
      insert into listings (
        creator_id, slug, title, summary, description, category, terminals, price, license,
        sub_period_days, holder_only_hours, holder_only, update_price, kind, specs
      ) values (
        ${user.id}, ${slug}, ${body.title}, ${body.summary}, ${body.description}, ${body.category}::category,
        ${deps.sql.array(body.terminals)}, ${BigInt(body.priceLamports)}, ${body.license}::license_kind,
        ${body.subPeriodDays ?? null}, ${body.holderOnlyHours}, ${body.holderOnly}, ${updatePrice},
        ${body.kind ?? null}, ${deps.sql.json((body.specs ?? {}) as never)}::jsonb
      ) returning id
    `;
    return c.json({ id: inserted[0]?.id, slug });
  });

  api.get('/studio/listings/:id/content', async (c) => {
    const user = requireUser(c);
    const listing = await ownListingParam(deps, c.req.param('id'), user.id as string);
    const content = await studioContent(deps, listing);
    const cover = content.draft.coverImageId ?? content.draft.gallery[0]?.imageId ?? null;
    return c.json(
      jsonSafe({
        listing: {
          ...publicListing(listing),
          liveVersionId: listing.live_version_id,
          handle: user.handle,
          cover: cover ? { url: mediaUrl(cover), alt: '' } : null,
          imageCount: content.draft.gallery.length,
        },
        ...content,
      }),
    );
  });

  api.put('/studio/listings/:id/content', async (c) => {
    const user = requireUser(c);
    const listing = await ownListingParam(deps, c.req.param('id'), user.id as string);
    const body = await bodyOf(contentBody, await c.req.json());
    const draft = await saveDraft(deps, listing.id as string, body);
    return c.json({ ok: true, draft });
  });

  api.post('/studio/listings/:id/content/review', async (c) => {
    const user = requireUser(c);
    const listing = await ownListingParam(deps, c.req.param('id'), user.id as string);
    const text = await c.req.text();
    const body = await bodyOf(reviewContentBody, text ? JSON.parse(text) : {});
    return c.json(
      jsonSafe(await reviewContent(deps, listing.id as string, user.id as string, body.note)),
    );
  });

  api.post('/studio/listings/:id/images', async (c) => {
    const user = requireUser(c);
    const listing = await ownListingParam(deps, c.req.param('id'), user.id as string);
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > IMAGE_MAX_BYTES) {
      throw new HttpError(413, 'IMAGE_TOO_LARGE', 'images are limited to 3 MB');
    }
    // Chunked uploads carry no content-length, so the limit is enforced while reading too.
    const bytes = await readCapped(c.req.raw.body, IMAGE_MAX_BYTES);
    return c.json(await uploadImage(deps, listing.id as string, user.id as string, bytes));
  });

  api.delete('/studio/listings/:id/images/:imageId', async (c) => {
    const user = requireUser(c);
    const listing = await ownListingParam(deps, c.req.param('id'), user.id as string);
    const imageId = c.req.param('imageId');
    if (!isUuid(imageId)) throw new HttpError(404, 'NOT_FOUND', 'image not found');
    await deleteImage(deps, listing.id as string, imageId);
    return c.json({ ok: true });
  });

  api.patch('/studio/listings/:id', async (c) => {
    const user = requireUser(c);
    const listing = await ownListing(deps, c.req.param('id'), user.id as string);
    const body = await bodyOf(listingPatch, await c.req.json());
    await deps.sql`
      update listings set
        title = coalesce(${body.title ?? null}, title),
        summary = coalesce(${body.summary ?? null}, summary),
        description = coalesce(${body.description ?? null}, description),
        price = coalesce(${body.priceLamports ? BigInt(body.priceLamports) : null}, price),
        holder_only = coalesce(${body.holderOnly ?? null}, holder_only),
        holder_only_hours = coalesce(${body.holderOnlyHours ?? null}, holder_only_hours),
        update_price = coalesce(${body.updatePriceLamports !== undefined ? BigInt(body.updatePriceLamports) : null}, update_price)
      where id = ${listing.id}
    `;
    return c.json({ ok: true });
  });

  api.post('/studio/listings/:id/versions', async (c) => {
    const user = requireUser(c);
    requireRole(user, 'creator');
    const listing = await ownListing(deps, c.req.param('id'), user.id as string);
    const body = await bodyOf(versionBody, await c.req.json());
    const config = await loadConfig(deps);
    const max =
      listing.category === 'setup' ? config.max_file_bytes.setup : config.max_file_bytes.default;
    if (body.fileSize > max)
      throw new HttpError(400, 'FILE_TOO_LARGE', 'file exceeds the category limit');
    const tier = await tierForWallet(deps, user.wallet as string, config);
    const waived = tierAtLeast(tier.tier, config.verification_fee_free_from_tier);
    const fee = waived ? 0n : config.verification_fee_lamports;
    // Daily limits are enforced here, under a per-creator lock (see versioning.ts).
    const created = await createVersionRow(deps, {
      listing,
      semver: body.semver,
      changelog: body.changelog,
      fileName: body.fileName,
      fileSize: body.fileSize,
      vfeeLamports: fee,
      acceptSupplementLamports: body.acceptSupplementLamports,
      config,
    });
    const id = created.versionId;
    const key = `uploads/${id}`;
    const exp = Math.floor(deps.now().getTime() / 1000) + 15 * 60;
    const feeTx =
      fee > 0n
        ? await buildVaultTx(deps, user.wallet as string, fee, verificationFeeMemo(id))
        : null;
    const supplement = await supplementState(deps, created.supplement?.id, user.wallet as string);
    return c.json(
      jsonSafe({
        versionId: id,
        uploadUrl: deps.blob.signedPut(key, exp),
        verificationFee: fee,
        feeTx,
        supplement: supplement
          ? {
              id: supplement.id,
              lamports: supplement.lamports,
              reasons: created.supplement?.reasons ?? [],
              tx: supplement.tx,
            }
          : null,
      }),
    );
  });

  api.get('/studio/listings/:id/upload-quota', async (c) => {
    const user = requireUser(c);
    const listing = await ownListingParam(deps, c.req.param('id'), user.id as string);
    const config = await loadConfig(deps);
    const quota = await uploadQuota(deps.sql, deps.now(), config, listing);
    const tier = await tierForWallet(deps, user.wallet as string, config);
    const versions = await deps.sql<Record<string, any>[]>`
      select id, semver, status, changelog, created_at, live_at from versions
      where listing_id = ${listing.id} order by created_at desc limit 20
    `;
    return c.json(
      jsonSafe({
        listing: {
          ...publicListing(listing),
          updatePrice: listing.update_price,
          liveVersionId: listing.live_version_id,
        },
        ...quota,
        verificationFee: config.verification_fee_lamports,
        feeWaived: tierAtLeast(tier.tier, config.verification_fee_free_from_tier),
        suggestedUpdatePrice: suggestedUpdatePrice(listing.price as bigint, config),
        versions,
      }),
    );
  });

  api.post('/studio/versions/:id/fee', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(submittedBody, await c.req.json());
    await ownVersion(deps, c.req.param('id'), user.id as string);
    const result = await applyPayment(deps, {
      kind: 'vfee',
      id: c.req.param('id'),
      txSig: body.txSig,
      actorId: user.id as string,
    });
    if (!result.ok) throw new HttpError(400, result.code, result.message);
    return c.json({ ok: true });
  });

  // A fresh unsigned fee transaction: the one returned at version creation carries a
  // blockhash that expires after about a minute, so a retry needs a new one.
  api.post('/studio/versions/:id/fee-tx', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    const fee = version.vfee_lamports as bigint;
    const feeTx =
      fee > 0n && !version.vfee_sig
        ? await buildVaultTx(
            deps,
            user.wallet as string,
            fee,
            verificationFeeMemo(version.id as string),
          )
        : null;
    const supplement = await supplementState(
      deps,
      version.supplement_id as string | null,
      user.wallet as string,
    );
    return c.json(
      jsonSafe({
        verificationFee: fee,
        paid: fee === 0n || Boolean(version.vfee_sig),
        feeTx,
        supplement,
      }),
    );
  });

  api.post('/studio/versions/:id/complete', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    if ((version.vfee_lamports as bigint) > 0n && !version.vfee_sig) {
      throw new HttpError(400, 'FEE_REQUIRED', 'verification fee is not paid');
    }
    await assertSupplementPaid(deps, version);
    const bytes = await deps.blob.get(`uploads/${version.id}`);
    if (!bytes) throw new HttpError(400, 'FILE_MISSING', 'upload the file first');
    const hash = await sha256Hex(bytes);
    const clash = await deps.sql`
      select v.id from versions v join listings l on l.id = v.listing_id
      where v.sha256 = ${hash} and l.creator_id <> ${user.id} limit 1
    `;
    if (clash.length > 0)
      throw new HttpError(409, 'STOLEN_UPLOAD', 'this file is already pinned by another creator');
    const key = `blobs/${hash}`;
    await deps.blob.put(key, bytes);
    await deps.blob.delete(`uploads/${version.id}`);
    await deps.sql`update versions set sha256 = ${hash}, r2_key = ${key}, file_size = ${bytes.length}, status = 'scanning' where id = ${version.id}`;
    const stream =
      c.req.query('stream') === '1' || (c.req.header('accept') ?? '').includes('text/event-stream');
    if (stream) {
      return streamSSE(c, async (events) => {
        for await (const event of reviewVersion(deps, version.id as string)) {
          await events.writeSSE({ event: event.step, data: JSON.stringify(jsonSafe(event)) });
        }
      });
    }
    const last = await finishVersion(deps, version.id as string);
    const fresh = await deps.sql<
      Record<string, any>[]
    >`select status, r2_key, sha256, wallet_count as "walletCount" from versions where id = ${version.id}`;
    return c.json({ ...(fresh[0] ?? {}), review: last });
  });

  api.post('/studio/versions/:id/review', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    if (version.status === 'rejected') {
      throw new HttpError(403, 'NO_APPEAL', 'a rejected version has no appeal');
    }
    const stream =
      c.req.query('stream') === '1' || (c.req.header('accept') ?? '').includes('text/event-stream');
    if (stream) {
      return streamSSE(c, async (events) => {
        for await (const event of reviewVersion(deps, version.id as string)) {
          await events.writeSSE({ event: event.step, data: JSON.stringify(jsonSafe(event)) });
        }
      });
    }
    return c.json(jsonSafe(await finishVersion(deps, version.id as string)));
  });

  api.post('/studio/versions/:id/reupload', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    if (version.status !== 'needs_creator') {
      throw new HttpError(400, 'NOT_PAUSED', 'upload a fix when the AI requests changes');
    }
    const body = await bodyOf(reuploadBody, await c.req.json());
    const bytes = Uint8Array.from(atob(body.contentBase64), (char) => char.charCodeAt(0));
    const hash = await sha256Hex(bytes);
    const key = `blobs/${hash}`;
    await deps.blob.put(key, bytes);
    const sameBytes = hash === version.sha256;
    if (!sameBytes) {
      await deps.sql`delete from scans where version_id = ${version.id} and kind = 'static'`;
    }
    await deps.sql`
      update versions set file_name = ${body.fileName}, file_size = ${bytes.length}, sha256 = ${hash},
        r2_key = ${key}, status = 'scanning'
      where id = ${version.id}
    `;
    return c.json({
      versionId: version.id,
      sha256: hash,
      resumeStep: sameBytes ? (version.resume_step ?? 'static') : version.resume_step,
    });
  });

  api.post('/studio/versions/:id/appeal', (c) => {
    requireUser(c);
    throw new HttpError(404, 'NO_APPEAL', 'AI review has no human appeal');
  });

  api.get('/studio/versions/:id', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    const checks = await deps.sql<Record<string, any>[]>`
      select sc.rule_id, sc.result, sc.title, sc.detail, sc.locations, s.kind
      from scan_checks sc join scans s on s.id = sc.scan_id
      where s.version_id = ${version.id} order by s.started_at, sc.rule_id
    `;
    const review = await deps.sql<Record<string, any>[]>`
      select agent_id, decision, notes, attestation, signature, created_at from ai_reviews
      where version_id = ${version.id} order by created_at desc limit 1
    `;
    return c.json(jsonSafe({ version, checks, review: review[0] ?? null }));
  });

  api.post('/studio/versions/:id/explain', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    if (version.status !== 'needs_creator')
      throw new HttpError(400, 'NOT_EXPLAINABLE', 'this version is not waiting on a note');
    const body = await bodyOf(explainBody, await c.req.json());
    await deps.sql`update versions set creator_note = ${body.note} where id = ${version.id}`;
    await finishVersion(deps, version.id as string);
    const fresh = await deps.sql<
      { status: string }[]
    >`select status from versions where id = ${version.id}`;
    return c.json({ status: fresh[0]?.status });
  });

  api.get('/studio/payouts', async (c) => {
    const user = requireUser(c);
    const rows = await deps.sql<Record<string, any>[]>`
      select * from payouts where recipient = ${user.wallet} order by created_at desc limit 100
    `;
    const price = await solPrice();
    const total = rows.reduce((sum, row) => sum + (row.amount as bigint), 0n);
    return c.json(
      jsonSafe({
        solUsd: { centsPerSol: price.centsPerSol, source: price.source },
        total: moneyView(total, price.centsPerSol, formatSol(total)),
        payouts: rows.map((row) => ({
          ...row,
          amount: moneyView(
            row.amount as bigint,
            price.centsPerSol,
            formatSol(row.amount as bigint),
          ),
          lamports: row.amount,
        })),
      }),
    );
  });

  api.get('/studio/overview', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await retryTransientRead(() => studioOverview(deps, user))));
  });

  api.get('/studio/sales', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await studioSales(deps, user, c.req.query())));
  });

  api.get('/studio/subscribers', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await studioSubscribers(deps, user)));
  });

  api.get('/studio/reviews', async (c) => {
    const user = requireUser(c);
    return c.json(jsonSafe(await studioReviews(deps, user, c.req.query())));
  });

  api.get('/studio/listings', async (c) => {
    const user = requireUser(c);
    const rows = await deps.sql<Record<string, any>[]>`
      select l.*, v.status as version_status, v.semver from listings l
      left join versions v on v.id = l.live_version_id
      where l.creator_id = ${user.id} order by l.created_at desc
    `;
    return c.json(jsonSafe(rows));
  });

  api.post('/studio/listings/:id/delist', async (c) => {
    const user = requireUser(c);
    const listing = await ownListing(deps, c.req.param('id'), user.id as string);
    await deps.sql`update listings set delisted_at = ${deps.now()} where id = ${listing.id}`;
    await deps.sql`update versions set status = 'delisted' where listing_id = ${listing.id} and status = 'live'`;
    return c.json({ ok: true });
  });

  api.get('/admin/disputes', async (c) => {
    requireRole(requireUser(c), 'admin');
    const rows = await deps.sql<
      Record<string, any>[]
    >`select * from disputes where status = 'open' order by created_at asc`;
    return c.json(jsonSafe(rows));
  });

  api.post('/admin/disputes/:id/resolve', async (c) => {
    const admin = requireUser(c);
    requireRole(admin, 'admin');
    const body = await bodyOf(resolveDisputeBody, await c.req.json());
    await resolveDispute(deps, c.req.param('id'), admin.id as string, {
      status: body.status,
      resolution: body.resolution,
      slashLamports: body.slashLamports ? BigInt(body.slashLamports) : undefined,
    });
    return c.json({ ok: true });
  });

  api.post('/admin/listings/:id/delist', async (c) => {
    requireRole(requireUser(c), 'admin');
    await deps.sql`update listings set delisted_at = ${deps.now()} where id = ${c.req.param('id')}`;
    return c.json({ ok: true });
  });

  api.put('/admin/config/:key', async (c) => {
    const admin = requireUser(c);
    requireRole(admin, 'admin');
    const body = await bodyOf(configValueBody, await c.req.json());
    const key = c.req.param('key');
    await deps.sql`
      insert into config (key, value) values (${key}, ${deps.sql.json(body.value as never)})
      on conflict (key) do update set value = excluded.value
    `;
    await audit(deps.sql, admin.id as string, 'config', admin.id as string, 'config_put', { key });
    return c.json({ ok: true });
  });

  api.get('/admin/payouts/batches', async (c) => {
    requireRole(requireUser(c), 'admin');
    const rows = await deps.sql<Record<string, any>[]>`
      select batch_id, status, count(*)::int as count, coalesce(sum(amount), 0)::bigint as total
      from payouts where batch_id is not null group by batch_id, status order by min(created_at) desc
    `;
    return c.json(jsonSafe(rows));
  });

  api.post('/admin/payouts/batches/:id/sent', async (c) => {
    requireRole(requireUser(c), 'admin');
    const body = await bodyOf(batchSentBody, await c.req.json());
    const count = await markBatchSent(deps, c.req.param('id'), body.txSig);
    return c.json({ count });
  });

  api.post('/admin/users/:id/roles', async (c) => {
    requireRole(requireUser(c), 'admin');
    const body = await bodyOf(roleBody, await c.req.json());
    await deps.sql`update users set roles = ${deps.sql.array(body.roles)}::user_role[] where id = ${c.req.param('id')}`;
    return c.json({ ok: true });
  });

  api.post('/admin/buybacks', async (c) => {
    requireRole(requireUser(c), 'admin');
    const body = await bodyOf(buybackBody, await c.req.json());
    await deps.sql`
      insert into buybacks (tx_sig, sol_lamports, note) values (${body.txSig}, ${BigInt(body.solLamports)}, ${body.note})
    `;
    return c.json({ ok: true });
  });

  api.get('/admin/ledger', async (c) => {
    requireRole(requireUser(c), 'admin');
    const vault = await ledgerVault(deps.sql);
    return c.json(
      jsonSafe({ vault, invariant: 'on-chain vault balance must stay >= this ledger sum' }),
    );
  });

  api.post('/hooks/helius', async (c) => {
    const header = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(header, deps.env.webhookSecret)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'webhook secret required');
    }
    const payload = await c.req.json();
    const events = Array.isArray(payload) ? payload : [payload];
    const results = [];
    for (const event of events) {
      const signature = String(event.signature ?? '');
      if (!signature) continue;
      const seen =
        await deps.sql`select 1 from orders where tx_sig = ${signature} union select 1 from bonds where tx_sig = ${signature}`;
      if (seen.length > 0) {
        results.push({ signature, duplicate: true });
        continue;
      }
      // I-06: the body only tells us which wallets to look at. Amounts come from chain.
      if (Array.isArray(event.tokenBalances)) {
        const wallets = new Set<string>();
        for (const row of event.tokenBalances as { wallet?: unknown; mint?: unknown }[]) {
          if (typeof row.wallet !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.wallet))
            continue;
          if (deps.env.trenchMint && row.mint && row.mint !== deps.env.trenchMint) continue;
          wallets.add(row.wallet);
        }
        for (const wallet of [...wallets].slice(0, 20))
          await recordChainBalance(deps, wallet, signature);
      }
      // The memo is read from the confirmed transaction only, and must match exactly.
      const tx = await deps.getTx(signature);
      const memo = tx?.memos[0] ?? '';
      const pending = memo
        ? await deps.sql<{ id: string }[]>`
            select id from orders where status = 'pending' and memo = ${memo} limit 1
          `
        : [];
      const order = pending[0];
      if (order) {
        const result = await applyPayment(deps, {
          kind: 'order',
          id: order.id,
          txSig: signature,
          actorId: null,
        });
        results.push({ signature, ...result });
      } else results.push({ signature, matched: false });
    }
    return c.json({ results });
  });

  api.get('/stats', async (c) => {
    // Independent reads: run them together instead of three round trips in a row.
    const [stats, price, paid] = await Promise.all([
      landingStats(deps),
      solPrice(),
      paidToCreators(deps),
    ]);
    return c.json(
      jsonSafe({
        ...stats,
        paidToCreators: {
          ...moneyView(paid.lamports, price.centsPerSol, formatSol(paid.lamports)),
          last24hLamports: paid.last24h,
          orders: paid.orders,
        },
        volume: moneyView(
          BigInt(stats.volumeLamports),
          price.centsPerSol,
          formatSol(BigInt(stats.volumeLamports)),
        ),
        solUsd: { centsPerSol: price.centsPerSol, source: price.source },
      }),
    );
  });

  api.get('/prices/sol', async (c) => {
    const price = await solPrice();
    return c.json({
      centsPerSol: price.centsPerSol?.toString() ?? null,
      source: price.source,
      fetchedAt: price.fetchedAt,
    });
  });

  api.get('/internal/sandbox/next', async (c) => {
    assertInternal(c, deps.env);
    return c.json({
      queued: false,
      message:
        'AI review runs in an isolated sandbox during upload and streams progress. There is no human or batch queue.',
    });
  });

  api.post('/internal/sandbox/:versionId/result', async (c) => {
    assertInternal(c, deps.env);
    const raw = (await c.req.json()) as Record<string, unknown>;
    await storeSandbox(deps, c.req.param('versionId'), raw);
    return c.json({ ok: true });
  });

  // Ops check for M-03: which client IP the API derives for this request (internal only).
  api.get('/internal/whoami', (c) => {
    assertInternal(c, deps.env);
    return c.json({
      ip: clientIp(c, deps.env),
      viaProxy: Boolean(
        deps.env.proxySecret && safeEqual(c.req.header('x-tm-proxy') ?? '', deps.env.proxySecret),
      ),
      cfConnectingIp: c.req.header('cf-connecting-ip') ?? null,
    });
  });

  // Monitoring endpoint for an external uptime check: 200 {"ok":true} or 503 with alerts.
  api.get('/internal/ops', async (c) => {
    assertInternal(c, deps.env);
    const alerts = await opsCheck(deps);
    const critical = alerts.some((a) => a.level === 'critical');
    return c.json({ ok: !critical, alerts }, critical ? 503 : 200);
  });

  // Runs the check and delivers notices like the cron does (used to verify alerting).
  api.post('/internal/ops/run', async (c) => {
    assertInternal(c, deps.env);
    const alerts = await opsCheck(deps);
    const notices = await deliverAlerts(deps, alerts);
    return c.json({ alerts, notices });
  });

  // Delivery test: one notice per channel, marked TEST. ?code= sends a sample of that alert.
  api.post('/internal/ops/test', async (c) => {
    assertInternal(c, deps.env);
    const code = c.req.query('code') ?? 'DELIVERY';
    const channels = await notify(deps, {
      title: `TEST ${code}`,
      body: `Test of the ${code} alert path. No action needed.`,
      level: 'test',
    });
    return c.json({ channels });
  });

  // Machine-readable open + recent resolved alerts for the assistant poller (Bearer INTERNAL_TOKEN).
  api.get('/internal/ops/alerts', async (c) => {
    assertInternal(c, deps.env);
    const live = await opsCheck(deps);
    const rows = await opsAlertRows(deps);
    return c.json(
      jsonSafe({
        checkedAt: deps.now().toISOString(),
        ok: !live.some((a) => a.level === 'critical'),
        live,
        open: rows.open,
        resolved: rows.resolved,
        delivery: 'assistant',
      }),
    );
  });

  api.get('/admin/ops', async (c) => {
    requireRole(requireUser(c), 'admin');
    return c.json(jsonSafe(await opsStatus(deps)));
  });

  api.post('/internal/cron/:job', async (c) => {
    assertInternal(c, deps.env);
    const job = c.req.param('job');
    if (job === 'expire') return c.json({ expired: await expireOrders(deps) });
    if (job === 'release') return c.json({ released: await releaseOrders(deps) });
    if (job === 'payouts') return c.json({ batch: await proposePayouts(deps) });
    if (job === 'ledger') return c.json(jsonSafe({ vault: await ledgerVault(deps.sql) }));
    if (job === 'ranking')
      return c.json(jsonSafe({ ranks: await computeRanks(deps, { force: true }) }));
    if (job === 'featuring') return c.json(await featureMaintenance(deps));
    if (job === 'wallet-intel') return c.json({ scanned: await scanWalletIntel(deps) });
    if (job === 'optimize-media') return c.json({ optimized: await optimizeStoredImages(deps) });
    throw new HttpError(404, 'NOT_FOUND', 'unknown job');
  });

  app.route('/api/v1', api);
  return app;
}

function clientIpHash(
  c: { req: { header: (name: string) => string | undefined } },
  deps: Deps,
): string {
  // Edge-provided client IP only (M-03): X-Forwarded-For is client-controlled.
  const ip = clientIp(c, deps.env);
  // IPv6 clients rotate within their /64, so the network is the unit, not the address.
  const network = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
  return ipHash(`verify:${network}`, deps.env.sessionSecret);
}

function assertInternal(
  c: { req: { header: (name: string) => string | undefined } },
  env: Env,
): void {
  const header = c.req.header('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!safeEqual(token, env.internalToken))
    throw new HttpError(401, 'UNAUTHORIZED', 'internal token required');
}

/**
 * M-03: the client IP for rate limiting and download logs. Cloudflare sets
 * `CF-Connecting-IP` and clients cannot override it. Requests proxied by the web Worker
 * arrive from Cloudflare's own address, so the web middleware forwards the browser's IP in
 * `x-tm-client-ip`, trusted only with the shared `x-tm-proxy` secret.
 */
export function clientIp(
  c: { req: { header: (name: string) => string | undefined } },
  env: Env,
): string {
  const proxied = c.req.header('x-tm-client-ip');
  if (proxied && env.proxySecret && safeEqual(c.req.header('x-tm-proxy') ?? '', env.proxySecret))
    return proxied.trim();
  return c.req.header('cf-connecting-ip')?.trim() || 'local';
}

/** Constant-time string comparison for shared secrets (I-06). */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (!b || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function publicUser(user: Record<string, any>) {
  return {
    id: user.id,
    wallet: user.wallet,
    handle: user.handle,
    xHandle: user.x_handle,
    xVerified: xVerified(user),
    displayName: user.display_name ?? null,
    avatarUrl: user.avatar_media_id ? `/api/v1/profile-media/${user.avatar_media_id}` : null,
    roles: user.roles,
  };
}

function publicListing(listing: Record<string, any>) {
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    summary: listing.summary,
    description: listing.description,
    category: listing.category,
    terminals: listing.terminals,
    price: listing.price,
    license: listing.license,
    holderOnly: listing.holder_only,
    holderOnlyHours: listing.holder_only_hours,
    featured: listing.is_featured,
    sales7d: listing.sales_7d,
    ratingAvg: listing.rating_avg,
    ratingCount: listing.rating_count,
    upvotes: listing.upvote_count ?? 0,
    rank:
      listing.rank_category || listing.rank_overall
        ? { category: listing.rank_category ?? null, overall: listing.rank_overall ?? null }
        : null,
    firstLiveAt: listing.first_live_at,
    delistedAt: listing.delisted_at,
    updatePrice: listing.update_price ?? null,
    kind: listing.kind ?? null,
    specs: listing.kind ? (listing.specs ?? {}) : null,
    categoryMeta: categoryMeta(listing.category as string),
  };
}

function creatorCard(listing: Record<string, any>, bond: bigint) {
  return {
    handle: listing.handle,
    wallet: listing.creator_wallet,
    xHandle: listing.x_handle,
    xVerified: xVerified(listing),
    bondLamports: bond,
  };
}

async function ownOrder(deps: Deps, id: string, userId: string) {
  const rows = await deps.sql<
    Record<string, any>[]
  >`select * from orders where id = ${id} and buyer_id = ${userId}`;
  const order = rows[0];
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  return order;
}

async function ownListing(deps: Deps, id: string, userId: string) {
  const rows = await deps.sql<
    Record<string, any>[]
  >`select * from listings where id = ${id} and creator_id = ${userId}`;
  const listing = rows[0];
  if (!listing) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
  return listing;
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'IMAGE_TOO_LARGE', 'images are limited to 3 MB');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function ownListingParam(deps: Deps, id: string, userId: string) {
  if (!isUuid(id)) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
  return ownListing(deps, id, userId);
}

async function ownVersion(deps: Deps, id: string, userId: string) {
  const rows = await deps.sql<Record<string, any>[]>`
    select v.* from versions v join listings l on l.id = v.listing_id
    where v.id = ${id} and l.creator_id = ${userId}
  `;
  const version = rows[0];
  if (!version) throw new HttpError(404, 'NOT_FOUND', 'version not found');
  return version;
}

async function assertBond(deps: Deps, user: Record<string, any>, category: string) {
  const config = await loadConfig(deps);
  const tier = await tierForWallet(deps, user.wallet as string, config);
  const required = requiredBondLamports(
    [category],
    config.bond_lamports_by_category,
    tier.tier,
    config.og_bond_discount_bps,
  );
  const bond = await activeBond(deps.sql, user.id as string);
  if (bond < required) throw new HttpError(400, 'BOND_REQUIRED', 'stake the category bond first');
}

async function uniqueSlug(deps: Deps, title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'listing';
  for (let i = 0; i < 5; i += 1) {
    const slug = i === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 4)}`;
    const existing = await deps.sql`select 1 from listings where slug = ${slug}`;
    if (existing.length === 0) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function searchListings(
  deps: Deps,
  query: {
    q?: string;
    category?: string;
    terminal?: string;
    sort?: string;
    cursor?: string;
    limit?: number;
    ids?: string[];
  },
  tier: string,
) {
  const limit = query.limit ?? 24;
  const sort = query.sort ?? 'trending';
  const order =
    sort === 'new'
      ? 'l.created_at desc'
      : sort === 'price_asc'
        ? 'l.price asc'
        : sort === 'price_desc'
          ? 'l.price desc'
          : sort === 'rating'
            ? 'l.rating_avg desc nulls last'
            : sort === 'top'
              ? 'l.rank_overall asc nulls last, l.sales_7d desc'
              : 'l.sales_7d desc';
  // Padre links resolve to Terminal; matching ignores case (the Trojan listing stored 'trojan').
  const terminalFilter = query.terminal
    ? (canonicalTerminal(query.terminal) ?? query.terminal)
    : null;
  const rows = await deps.sql<Record<string, any>[]>`
    select l.*, u.handle,
      c.live->>'coverImageId' as cover_image_id,
      coalesce(jsonb_array_length(c.live->'gallery'), 0)::int as image_count
    from listings l join users u on u.id = l.creator_id
    left join listing_content c on c.listing_id = l.id
    where l.delisted_at is null and l.paused_at is null and l.live_version_id is not null
      and (${query.category ?? null}::text is null or l.category::text = ${query.category ?? null})
      and (${terminalFilter}::text is null or exists (select 1 from unnest(l.terminals) t where lower(t) = lower(${terminalFilter})))
      and (${query.q ?? null}::text is null or l.search @@ plainto_tsquery('english', ${query.q ?? ''}))
      and (${query.ids ? query.ids : null}::uuid[] is null or l.id = any(${query.ids ?? []}::uuid[]))
    order by ${deps.sql.unsafe(order)}
    limit ${limit}
  `;
  return rows.map((listing) => {
    let lockedUntil: string | null = null;
    if (listing.holder_only_hours > 0 && listing.first_live_at && tier === 'none') {
      const until = new Date(
        listing.first_live_at.getTime() + listing.holder_only_hours * 3_600_000,
      );
      if (until > deps.now()) lockedUntil = until.toISOString();
    }
    return {
      ...publicListing(listing),
      handle: listing.handle,
      lockedUntil,
      cover: listing.cover_image_id
        ? {
            url: mediaUrl(listing.cover_image_id as string),
            alt: `${listing.title as string} cover`,
          }
        : null,
      imageCount: listing.image_count as number,
    };
  });
}

async function securityBlock(deps: Deps, versionId: string) {
  const versions = await deps.sql<
    Record<string, any>[]
  >`select * from versions where id = ${versionId}`;
  const version = versions[0];
  if (!version) return null;
  const checks = await deps.sql<Record<string, any>[]>`
    select sc.rule_id as "ruleId", sc.result, sc.title, sc.detail
    from scan_checks sc join scans s on s.id = sc.scan_id
    where s.version_id = ${versionId} and s.kind = 'static'
  `;
  const passed = checks.filter((check) => check.result === 'pass').length;
  const reviewRows = await deps.sql<Record<string, any>[]>`
    select * from ai_reviews where version_id = ${versionId} and decision = 'approve' order by created_at desc limit 1
  `;
  const review = reviewRows[0];
  return {
    versionId,
    semver: version.semver,
    sha256: version.sha256,
    r2Key: version.r2_key,
    summary: checks.some((check) => check.result === 'fail')
      ? 'fail'
      : checks.some((check) => check.result === 'warn')
        ? 'warn'
        : 'pass',
    passed,
    total: checks.length,
    checks,
    declared: version.declared,
    walletCount:
      typeof version.wallet_count === 'number'
        ? {
            count: version.wallet_count,
            versionId,
            semver: version.semver,
            source: 'file' as const,
            facts: version.wallet_facts ?? null,
          }
        : null,
    review: review
      ? {
          verifierHandle: review.agent_id,
          agentId: review.agent_id,
          decision: review.decision,
          signedAt: review.created_at,
          signature: review.signature,
          attestation: review.attestation,
        }
      : null,
  };
}

async function previewOf(deps: Deps, key?: string): Promise<string | null> {
  if (!key) return null;
  const bytes = await deps.blob.get(key);
  if (!bytes) return null;
  const text = new TextDecoder().decode(bytes.slice(0, 2000));
  const header = text.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  return header ? header[0].slice(0, 1500) : text.slice(0, 400);
}

async function matchFile(deps: Deps, fileName: string, bytes: Uint8Array) {
  let hash = await sha256Hex(bytes);
  if (fileName.toLowerCase().endsWith('.zip')) {
    try {
      const { unzipSync, strFromU8 } = await import('fflate');
      const files = unzipSync(bytes);
      const license = files['LICENSE-trenchmart.txt'];
      const pinned = license ? strFromU8(license).match(/sha256:\s*([a-f0-9]+)/)?.[1] : undefined;
      if (pinned) hash = pinned;
    } catch {
      hash = await sha256Hex(bytes);
    }
  } else {
    const stripped = stripWatermark(new TextDecoder().decode(bytes));
    hash = await sha256Hex(new TextEncoder().encode(stripped));
  }
  const rows = await deps.sql<Record<string, any>[]>`
    select v.semver, v.sha256, l.title, l.slug from versions v
    join listings l on l.id = v.listing_id
    where v.sha256 = ${hash} and v.status in ('live', 'superseded')
    limit 1
  `;
  const hit = rows[0];
  if (!hit) return { match: false, message: 'Does not match' };
  return {
    match: true,
    message: `Matches reviewed v${hit.semver} of ${hit.title}`,
    slug: hit.slug,
    semver: hit.semver,
  };
}

async function serveFile(c: any, deps: Deps, method: 'GET' | 'PUT') {
  const key = c.req.query('key') ?? '';
  const exp = Number(c.req.query('exp'));
  const sig = c.req.query('sig') ?? '';
  if (!deps.blob.verify(key, exp, sig, method, deps.now().getTime())) {
    return c.json({ error: { code: 'BAD_SIGNATURE', message: 'signed url is invalid' } }, 401);
  }
  if (method === 'GET') {
    const bytes = await deps.blob.get(key);
    if (!bytes) return c.json({ error: { code: 'NOT_FOUND', message: 'file not found' } }, 404);
    return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const config = await loadConfig(deps);
  if (bytes.length > config.max_file_bytes.setup) {
    return c.json({ error: { code: 'FILE_TOO_LARGE', message: 'upload is too large' } }, 400);
  }
  await deps.blob.put(key, bytes);
  return c.json({ ok: true, bytes: bytes.length });
}
