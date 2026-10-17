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
  reviewBody,
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
} from '@trenchmart/shared';
import { fromBase64, sendRaw } from '@trenchmart/chain';
import { cachedSolUsd, fetchCoinGeckoSolUsd, type PriceCache } from './price';
import type { Env } from './env';
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
  proposePayouts,
  quoteListing,
  releaseOrders,
  resolveDispute,
  reviewVersion,
  sha256Hex,
  storeSandbox,
  tierForWallet,
  watermarked,
  type Deps,
} from './logic';

type Vars = { user: Record<string, any> | null };
type App = Hono<{ Variables: Vars }>;

async function bodyOf<T>(schema: z.ZodType<T>, raw: unknown): Promise<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, 'BAD_REQUEST', issue?.message ?? 'invalid body');
  }
  return parsed.data;
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
export function createApp(deps: Deps, priceCache: PriceCacheBox = { value: null }): App {
  async function solPrice() {
    const quote = await cachedSolUsd({
      nowMs: deps.now().getTime(),
      cache: priceCache.value,
      override: deps.env.solUsdOverride,
      fetchUsd: deps.env.solUsdOverride ? undefined : fetchCoinGeckoSolUsd,
    });
    priceCache.value = quote.cache;
    return quote;
  }

  const app = new Hono<{ Variables: Vars }>();
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500);
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
    if (token) {
      const payload = await verifyJwt<{ sub?: string }>(
        token,
        deps.env.sessionSecret,
        deps.now().getTime(),
      );
      if (payload?.sub) {
        const rows = await deps.sql<
          Record<string, any>[]
        >`select * from users where id = ${payload.sub}`;
        if (rows[0]) c.set('user', rows[0]);
      }
    }
    const path = c.req.path;
    const write = c.req.method !== 'GET' && c.req.method !== 'OPTIONS' && !path.endsWith('/health');
    if (write) {
      const now = deps.now();
      const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
      const key = `${ip}:${c.req.method}`;
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
  api.get('/health', (c) => c.json({ ok: true, cluster: deps.env.cluster }));

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
    const used = await deps.sql`
      update auth_nonces set used_at = ${deps.now()} where nonce = ${matched.nonce} and used_at is null returning nonce
    `;
    if (used.length === 0) throw new HttpError(401, 'NONCE_USED', 'nonce already used');
    let users = await deps.sql<
      Record<string, any>[]
    >`select * from users where wallet = ${body.wallet}`;
    if (!users[0]) {
      users = await deps.sql<Record<string, any>[]>`
        insert into users (wallet, roles) values (${body.wallet}, ${deps.sql.array(['buyer'])}::user_role[]) returning *
      `;
    }
    const user = users[0];
    if (!user) throw new HttpError(500, 'INTERNAL', 'could not create user');
    await ensureSnapshot(deps, body.wallet);
    const token = await signJwt(
      { sub: user.id, exp: Math.floor(deps.now().getTime() / 1000) + 14 * 24 * 3600 },
      deps.env.sessionSecret,
    );
    setCookie(c, 'tm_session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 14 * 24 * 3600,
    });
    return c.json(jsonSafe({ user: publicUser(user) }));
  });

  api.post('/auth/logout', (c) => {
    requireUser(c);
    setCookie(c, 'tm_session', '', { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 });
    return c.body(null, 204);
  });

  api.get('/me', async (c) => {
    const user = requireUser(c);
    const config = await loadConfig(deps);
    const tier = await tierForWallet(deps, user.wallet as string, config);
    return c.json(
      jsonSafe({
        user: publicUser(user),
        roles: user.roles,
        tier: tier.tier,
        tierDetail: {
          minBalance: tier.minBalance,
          windowHours: config.tier_window_hours,
          nextTier: tier.nextTier,
          needed: tier.needed,
        },
      }),
    );
  });

  api.get('/auth/x/start', (c) => {
    requireUser(c);
    throw new HttpError(
      501,
      'X_UNCONFIGURED',
      'X OAuth is not configured. Use the dev handle link.',
    );
  });

  api.post('/studio/x', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(devLinkBody, await c.req.json());
    await deps.sql`update users set x_handle = ${body.handle}, x_user_id = ${'dev:' + body.handle} where id = ${user.id}`;
    return c.json({ handle: body.handle });
  });

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
      select l.*, u.handle, u.wallet as creator_wallet, u.x_handle
      from listings l join users u on u.id = l.creator_id
      where l.slug = ${slug}
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
        preview: await previewOf(deps, security?.r2Key),
      }),
    );
  });

  api.get('/listings/:slug/versions', async (c) => {
    const rows = await deps.sql<Record<string, any>[]>`
      select v.semver, v.changelog, v.created_at, v.status from versions v
      join listings l on l.id = v.listing_id
      where l.slug = ${c.req.param('slug')} and v.status in ('live', 'superseded')
      order by v.created_at desc
    `;
    return c.json(jsonSafe(rows));
  });

  api.get('/listings/:slug/reviews', async (c) => {
    const rows = await deps.sql<Record<string, any>[]>`
      select r.rating, r.body, r.created_at from listing_reviews r
      join listings l on l.id = r.listing_id where l.slug = ${c.req.param('slug')}
      order by r.created_at desc limit 20
    `;
    return c.json(jsonSafe(rows));
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
    const handle = c.req.param('handle').replace(/^@/, '');
    const users = await deps.sql<Record<string, any>[]>`
      select id, handle, wallet, x_handle from users
      where handle = ${handle} or x_handle = ${handle}
      limit 1
    `;
    const creator = users[0];
    if (!creator) throw new HttpError(404, 'NOT_FOUND', 'creator not found');
    const listings = await deps.sql<Record<string, any>[]>`
      select l.*, u.handle from listings l join users u on u.id = l.creator_id
      where l.creator_id = ${creator.id} and l.delisted_at is null and l.paused_at is null
        and l.live_version_id is not null
      order by l.created_at desc
    `;
    const bond = await activeBond(deps.sql, creator.id as string);
    return c.json(
      jsonSafe({
        handle: creator.handle,
        wallet: creator.wallet,
        xHandle: creator.x_handle,
        bond,
        listings: listings.map((listing) => publicListing(listing)),
      }),
    );
  });

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

  api.get('/orders/:id', async (c) => {
    const user = requireUser(c);
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    return c.json(jsonSafe(order));
  });

  api.get('/me/orders', async (c) => {
    const user = requireUser(c);
    const rows = await deps.sql<Record<string, any>[]>`
      select o.*, l.slug, l.title from orders o join listings l on l.id = o.listing_id
      where o.buyer_id = ${user.id} order by o.created_at desc
    `;
    const price = await solPrice();
    return c.json(
      jsonSafe({
        solUsd: { centsPerSol: price.centsPerSol, source: price.source },
        orders: rows.map((order) => ({
          ...order,
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
    if (order.status !== 'released') {
      throw new HttpError(403, 'ESCROW_LOCKED', 'downloads unlock after escrow releases the funds');
    }
    const license =
      await deps.sql`select 1 from licenses where order_id = ${order.id} and wallet = ${user.wallet}`;
    if (license.length === 0) throw new HttpError(403, 'NO_LICENSE', 'no license for this wallet');
    const versions = await deps.sql<
      Record<string, any>[]
    >`select * from versions where id = ${order.version_id}`;
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
    const key = `licensed/${order.id}/${version.file_name}`;
    await deps.blob.put(key, bytes);
    const exp = Math.floor(deps.now().getTime() / 1000) + 300;
    await deps.sql`
      insert into downloads (order_id, version_id, ip_hash)
      values (${order.id}, ${version.id}, ${ipHash(c.req.header('x-forwarded-for') || 'local', deps.env.sessionSecret)})
    `;
    return c.json({
      url: deps.blob.signedGet(key, exp),
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  });

  api.post('/orders/:id/review', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(reviewBody, await c.req.json());
    const order = await ownOrder(deps, c.req.param('id'), user.id as string);
    if (!['paid', 'released'].includes(order.status as string))
      throw new HttpError(400, 'UNPAID', 'review after purchase');
    await deps.sql`
      insert into listing_reviews (order_id, listing_id, rating, body)
      values (${order.id}, ${order.listing_id}, ${body.rating}, ${body.body})
    `;
    await deps.sql`
      update listings set
        rating_count = (select count(*) from listing_reviews where listing_id = ${order.listing_id}),
        rating_avg = (select round(avg(rating), 2) from listing_reviews where listing_id = ${order.listing_id})
      where id = ${order.listing_id}
    `;
    return c.json({ ok: true });
  });

  api.post('/orders/:id/dispute', async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(disputeBody, await c.req.json());
    const id = await openDispute(
      deps,
      c.req.param('id'),
      user.id as string,
      body.reason,
      body.details,
    );
    return c.json({ disputeId: id });
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

  api.post('/verify', async (c) => {
    const body = await bodyOf(verifyJsonBody, await c.req.json());
    const bytes = Uint8Array.from(atob(body.contentBase64), (char) => char.charCodeAt(0));
    return c.json(await matchFile(deps, body.fileName, bytes));
  });

  api.get('/studio/requirements', async (c) => {
    const user = requireUser(c);
    const config = await loadConfig(deps);
    const tier = await tierForWallet(deps, user.wallet as string, config);
    const categories = await deps.sql<{ category: string }[]>`
      select distinct category from listings where creator_id = ${user.id} and delisted_at is null and live_version_id is not null
    `;
    const required = bondToList(
      categories.map((row) => row.category),
      config.bond_lamports_by_category,
      tier.tier,
      config.og_bond_discount_bps,
    );
    const bond = await activeBond(deps.sql, user.id as string);
    return c.json(
      jsonSafe({
        creator: ((user.roles as string[] | undefined) ?? []).includes('creator'),
        walletSigned: true,
        xLinked: Boolean(user.x_handle),
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
    const inserted = await deps.sql<{ id: string }[]>`
      insert into bonds (user_id, amount, tx_sig, status)
      values (${user.id}, ${amount}, ${'pending-' + crypto.randomUUID()}, 'pending')
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new HttpError(500, 'INTERNAL', 'bond insert failed');
    const tx = await buildVaultTx(deps, user.wallet as string, amount, bondMemo(id));
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
    if (!user.x_handle) throw new HttpError(400, 'X_REQUIRED', 'link an X handle first');
    const body = await bodyOf(listingBody, await c.req.json());
    // The category bond is the gate (docs/06-payments-escrow.md). Meeting it makes the
    // wallet a creator, so a creator is never blocked by a role it cannot request.
    await assertBond(deps, user, body.category);
    await grantCreatorRole(deps.sql, user.id as string);
    const slug = await uniqueSlug(deps, body.title);
    const inserted = await deps.sql<{ id: string }[]>`
      insert into listings (
        creator_id, slug, title, summary, description, category, terminals, price, license,
        sub_period_days, holder_only_hours, holder_only
      ) values (
        ${user.id}, ${slug}, ${body.title}, ${body.summary}, ${body.description}, ${body.category}::category,
        ${deps.sql.array(body.terminals)}, ${BigInt(body.priceLamports)}, ${body.license}::license_kind,
        ${body.subPeriodDays ?? null}, ${body.holderOnlyHours}, ${body.holderOnly}
      ) returning id
    `;
    return c.json({ id: inserted[0]?.id, slug });
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
        holder_only_hours = coalesce(${body.holderOnlyHours ?? null}, holder_only_hours)
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
    const inserted = await deps.sql<{ id: string }[]>`
      insert into versions (listing_id, semver, changelog, file_name, file_size, sha256, r2_key, status, vfee_lamports)
      values (
        ${listing.id}, ${body.semver}, ${body.changelog}, ${body.fileName}, ${body.fileSize}, '', ${'uploads/pending'},
        'uploading', ${fee}
      ) returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new HttpError(500, 'INTERNAL', 'version insert failed');
    const key = `uploads/${id}`;
    await deps.sql`update versions set r2_key = ${key} where id = ${id}`;
    const exp = Math.floor(deps.now().getTime() / 1000) + 15 * 60;
    const feeTx =
      fee > 0n
        ? await buildVaultTx(deps, user.wallet as string, fee, verificationFeeMemo(id))
        : null;
    return c.json(
      jsonSafe({
        versionId: id,
        uploadUrl: deps.blob.signedPut(key, exp),
        verificationFee: fee,
        feeTx,
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
    return c.json(
      jsonSafe({ verificationFee: fee, paid: fee === 0n || Boolean(version.vfee_sig), feeTx }),
    );
  });

  api.post('/studio/versions/:id/complete', async (c) => {
    const user = requireUser(c);
    const version = await ownVersion(deps, c.req.param('id'), user.id as string);
    if ((version.vfee_lamports as bigint) > 0n && !version.vfee_sig) {
      throw new HttpError(400, 'FEE_REQUIRED', 'verification fee is not paid');
    }
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
    >`select status, r2_key, sha256 from versions where id = ${version.id}`;
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
    const header = c.req.header('authorization') ?? '';
    if (header !== deps.env.webhookSecret && header !== `Bearer ${deps.env.webhookSecret}`) {
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
      if (Array.isArray(event.tokenBalances)) {
        for (const row of event.tokenBalances as {
          wallet?: string;
          amount?: string;
          mint?: string;
        }[]) {
          if (!row.wallet || row.amount === undefined) continue;
          if (deps.env.trenchMint && row.mint && row.mint !== deps.env.trenchMint) continue;
          await deps.sql`
            insert into token_balances (wallet, amount, ts, source, tx_sig)
            values (${row.wallet}, ${row.amount}, ${deps.now()}, 'webhook', ${signature})
          `;
        }
      }
      const pending = await deps.sql<{ id: string; memo: string }[]>`
        select id, memo from orders where status = 'pending'
        union all
        select id, '' as memo from bonds where false
      `;
      const tx = await deps.getTx(signature);
      const memo = tx?.memos[0] ?? String(event.memo ?? '');
      const order = pending.find((row) => row.memo && memo.includes(row.memo));
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
    const stats = await landingStats(deps);
    const price = await solPrice();
    return c.json(
      jsonSafe({
        ...stats,
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

  api.post('/internal/cron/:job', async (c) => {
    assertInternal(c, deps.env);
    const job = c.req.param('job');
    if (job === 'expire') return c.json({ expired: await expireOrders(deps) });
    if (job === 'release') return c.json({ released: await releaseOrders(deps) });
    if (job === 'payouts') return c.json({ batch: await proposePayouts(deps) });
    if (job === 'ledger') return c.json(jsonSafe({ vault: await ledgerVault(deps.sql) }));
    throw new HttpError(404, 'NOT_FOUND', 'unknown job');
  });

  app.route('/api/v1', api);
  return app;
}

function assertInternal(
  c: { req: { header: (name: string) => string | undefined } },
  env: Env,
): void {
  const header = c.req.header('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (token !== env.internalToken)
    throw new HttpError(401, 'UNAUTHORIZED', 'internal token required');
}

function publicUser(user: Record<string, any>) {
  return {
    id: user.id,
    wallet: user.wallet,
    handle: user.handle,
    xHandle: user.x_handle,
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
    firstLiveAt: listing.first_live_at,
    delistedAt: listing.delisted_at,
    categoryMeta: categoryMeta(listing.category as string),
  };
}

function creatorCard(listing: Record<string, any>, bond: bigint) {
  return {
    handle: listing.handle,
    wallet: listing.creator_wallet,
    xHandle: listing.x_handle,
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
            : 'l.sales_7d desc';
  const rows = await deps.sql<Record<string, any>[]>`
    select l.*, u.handle from listings l join users u on u.id = l.creator_id
    where l.delisted_at is null and l.paused_at is null and l.live_version_id is not null
      and (${query.category ?? null}::text is null or l.category::text = ${query.category ?? null})
      and (${query.terminal ?? null}::text is null or ${query.terminal ?? null} = any(l.terminals))
      and (${query.q ?? null}::text is null or l.search @@ plainto_tsquery('english', ${query.q ?? ''}))
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
    return { ...publicListing(listing), handle: listing.handle, lockedUntil };
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
