import { randomUUID } from 'node:crypto';
import {
  assessPayment,
  defaultUpdatePrice,
  freeVerificationLeft,
  highestSemver,
  nextPatch,
  nextUtcDay,
  releasePayouts,
  renewalMemo,
  renewalQuote,
  renewalWindow,
  supplementMemo,
  updatesActive,
  uploadSupplementReasons,
  utcDayStart,
  versionEntitled,
  compareSemver,
  type AppConfig,
  type SupplementReason,
} from '@trenchmart/shared';
import type { ChainTx } from '@trenchmart/chain';
import type { Sql } from '@trenchmart/db';
import { HttpError, audit, buildVaultTx, loadConfig, tierForWallet, type Deps } from './logic';

type Row = Record<string, any>;

/**
 * An API error that carries extra fields in the error body (for example the supplement due).
 * It extends Error, not HttpError: logic.ts imports this module, so a class defined there is
 * not initialised yet when this module is evaluated.
 */
export class HttpDataError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Settled = { ok: true } | { ok: false; code: string; message: string };

// ---------------------------------------------------------------------------------------
// Seller uploads: one free update per listing and five free uploads per creator per UTC day.
// ---------------------------------------------------------------------------------------

export type UploadQuota = {
  isUpdate: boolean;
  updatesToday: number;
  uploadsToday: number;
  limits: { updatesPerListingPerDay: number; uploadsPerCreatorPerDay: number };
  reasons: SupplementReason[];
  supplementLamports: bigint;
  supplementRequired: boolean;
  resetsAt: Date;
  currentSemver: string | null;
  suggestedSemver: string;
};

export async function uploadQuota(
  sql: Sql,
  now: Date,
  config: AppConfig,
  listing: Row,
): Promise<UploadQuota> {
  const dayStart = utcDayStart(now);
  const [counts] = await sql<{ updates: number; uploads: number }[]>`
    select
      (select count(*)::int from versions where listing_id = ${listing.id} and is_update and created_at >= ${dayStart}) as updates,
      (select count(*)::int from versions v join listings l on l.id = v.listing_id
        where l.creator_id = ${listing.creator_id} and v.created_at >= ${dayStart}) as uploads
  `;
  const semvers = await sql<{ semver: string }[]>`
    select semver from versions where listing_id = ${listing.id} and status in ('live', 'superseded')
  `;
  const current = highestSemver(semvers.map((row) => row.semver));
  const isUpdate = Boolean(listing.first_live_at) || current !== null;
  const limits = {
    updatesPerListingPerDay: config.update_limit_per_listing_day,
    uploadsPerCreatorPerDay: config.upload_limit_per_creator_day,
  };
  const reasons = uploadSupplementReasons({
    isUpdate,
    updatesToday: counts?.updates ?? 0,
    uploadsToday: counts?.uploads ?? 0,
    limits,
  });
  return {
    isUpdate,
    updatesToday: counts?.updates ?? 0,
    uploadsToday: counts?.uploads ?? 0,
    limits,
    reasons,
    supplementLamports: config.upload_supplement_lamports,
    supplementRequired: reasons.length > 0 && config.upload_supplement_lamports > 0n,
    resetsAt: nextUtcDay(now),
    currentSemver: current,
    suggestedSemver: current ? nextPatch(current) : '1.0.0',
  };
}

/**
 * Creates the version row under a per-creator lock, so two parallel uploads cannot both take
 * the last free slot. Over the limit, the creator must have accepted the exact supplement
 * shown in the form; the version then carries a pending supplement that /complete requires.
 */
export async function createVersionRow(
  deps: Deps,
  input: {
    listing: Row;
    semver: string;
    changelog: string;
    fileName: string;
    fileSize: number;
    vfeeLamports: bigint;
    acceptSupplementLamports?: string;
    config: AppConfig;
  },
): Promise<{
  versionId: string;
  supplement: { id: string; lamports: bigint; reasons: string[] } | null;
}> {
  const { listing, config } = input;
  if (listing.delisted_at) throw new HttpError(400, 'DELISTED', 'this listing is delisted');
  return deps.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    await sql`select pg_advisory_xact_lock(hashtextextended(${'uploads:' + listing.creator_id}, 0))`;
    const quota = await uploadQuota(sql, deps.now(), config, listing);
    if (quota.isUpdate) {
      if (input.changelog.trim().length < 3) {
        throw new HttpError(400, 'CHANGELOG_REQUIRED', 'describe what changed in this version');
      }
      if (quota.currentSemver && compareSemver(input.semver, quota.currentSemver) <= 0) {
        throw new HttpError(
          400,
          'SEMVER_NOT_NEWER',
          `the new version must be higher than v${quota.currentSemver}`,
        );
      }
    }
    const taken =
      await sql`select 1 from versions where listing_id = ${listing.id} and semver = ${input.semver}`;
    if (taken.length > 0) {
      throw new HttpError(409, 'SEMVER_TAKEN', `v${input.semver} already exists for this listing`);
    }
    let supplement: { id: string; lamports: bigint; reasons: string[] } | null = null;
    if (quota.supplementRequired) {
      const due = quota.supplementLamports;
      if (input.acceptSupplementLamports !== due.toString()) {
        throw new HttpDataError(
          402,
          'SUPPLEMENT_REQUIRED',
          'the daily free limit is used up; this upload needs a SOL supplement',
          {
            supplement: {
              kind: 'upload',
              lamports: due.toString(),
              reasons: quota.reasons,
              resetsAt: quota.resetsAt.toISOString(),
            },
          },
        );
      }
      supplement = { id: randomUUID(), lamports: due, reasons: quota.reasons };
    }
    const versionId = randomUUID();
    if (supplement) {
      await sql`
        insert into supplements (id, user_id, kind, lamports, memo, reasons, ref_id, created_at)
        values (${supplement.id}, ${listing.creator_id}, 'upload', ${supplement.lamports},
          ${supplementMemo(supplement.id)}, ${sql.json(supplement.reasons as never)}, ${versionId}, ${deps.now()})
      `;
    }
    await sql`
      insert into versions (id, listing_id, semver, changelog, file_name, file_size, sha256, r2_key, status,
        vfee_lamports, is_update, supplement_id, created_at)
      values (
        ${versionId}, ${listing.id}, ${input.semver}, ${input.changelog}, ${input.fileName}, ${input.fileSize}, '',
        ${'uploads/' + versionId}, 'uploading', ${input.vfeeLamports}, ${quota.isUpdate}, ${supplement?.id ?? null},
        ${deps.now()}
      )
    `;
    return { versionId, supplement };
  });
}

export async function supplementState(
  deps: Deps,
  supplementId: string | null | undefined,
  wallet: string,
): Promise<{
  id: string;
  lamports: bigint;
  paid: boolean;
  tx: Awaited<ReturnType<typeof buildVaultTx>> | null;
} | null> {
  if (!supplementId) return null;
  const [row] = await deps.sql<Row[]>`select * from supplements where id = ${supplementId}`;
  if (!row) return null;
  const paid = row.status !== 'pending';
  const lamports = row.lamports as bigint;
  const tx =
    !paid && lamports > 0n
      ? await buildVaultTx(deps, wallet, lamports, supplementMemo(row.id as string))
      : null;
  return { id: row.id as string, lamports, paid: paid || lamports === 0n, tx };
}

/** A version's supplement must be paid before its file is scanned. */
export async function assertSupplementPaid(deps: Deps, version: Row): Promise<void> {
  if (!version.supplement_id) return;
  const [row] = await deps.sql<
    Row[]
  >`select status, lamports from supplements where id = ${version.supplement_id}`;
  if (!row) return;
  if (row.status === 'pending' && (row.lamports as bigint) > 0n) {
    throw new HttpError(400, 'SUPPLEMENT_UNPAID', 'the upload supplement is not paid');
  }
  await deps.sql`
    update supplements set status = 'used', used_at = ${deps.now()}
    where id = ${version.supplement_id} and status = 'paid'
  `;
}

/** Verifies an on-chain supplement payment to the vault, like the verification fee. */
export async function settleSupplement(
  deps: Deps,
  supplementId: string,
  userId: string,
  txSig: string,
): Promise<Settled> {
  const [row] = await deps.sql<Row[]>`
    select s.*, u.wallet from supplements s join users u on u.id = s.user_id
    where s.id = ${supplementId} and s.user_id = ${userId}
  `;
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'supplement not found' };
  if (row.tx_sig === txSig) return { ok: true };
  if (row.status !== 'pending')
    return { ok: false, code: 'NOT_PENDING', message: 'supplement is already paid' };
  const tx = await deps.getTx(txSig);
  if (!tx) return { ok: false, code: 'TX_NOT_FOUND', message: 'transaction not found' };
  const assessment = vaultPayment(deps, tx, {
    lamports: row.lamports as bigint,
    memo: supplementMemo(row.id as string),
    source: row.wallet as string,
    expiresAt: new Date((row.created_at as Date).getTime() + 86_400_000),
  });
  if (!assessment.ok) return assessment;
  const used = await deps.sql`
    select 1 from supplements where tx_sig = ${txSig}
    union all select 1 from update_renewals where tx_sig = ${txSig}
    union all select 1 from orders where tx_sig = ${txSig}
  `;
  if (used.length > 0)
    return { ok: false, code: 'DUPLICATE_SIG', message: 'signature already used' };
  const updated = await deps.sql`
    update supplements set status = 'paid', tx_sig = ${txSig}, paid_at = ${paidAt(deps, tx)}
    where id = ${supplementId} and status = 'pending' returning id
  `;
  if (updated.length === 0)
    return { ok: false, code: 'NOT_PENDING', message: 'supplement is already paid' };
  const config = await loadConfig(deps);
  // A supplement is a platform payment: it is split like the platform fee (no creator line).
  const lines = releasePayouts({
    price: 0n,
    netFee: row.lamports as bigint,
    splitBps: config.fee_split_bps,
    creatorWallet: '',
    buckets: deps.env.buckets,
  });
  for (const line of lines) {
    await deps.sql`
      insert into payouts (order_id, recipient, bucket, amount) values (null, ${line.recipient}, ${line.bucket}, ${line.amount})
    `;
  }
  await deps.sql`
    insert into ledger (account, delta, ref_type, ref_id) values ('vault', ${row.lamports}, 'supplement', ${supplementId})
  `;
  await audit(deps.sql, userId, 'supplement', supplementId, 'paid', { txSig, kind: row.kind });
  return { ok: true };
}

function paidAt(deps: Deps, tx: ChainTx): Date {
  return new Date((tx.blockTime ?? Math.floor(deps.now().getTime() / 1000)) * 1000);
}

function vaultPayment(
  deps: Deps,
  tx: ChainTx,
  expected: { lamports: bigint; memo: string; source: string; expiresAt: Date },
) {
  return assessPayment({
    status: 'pending',
    expectedLamports: expected.lamports,
    expectedMemo: expected.memo,
    expectedSource: expected.source,
    expectedDestination: deps.env.vaultAddress,
    transfers: tx.transfers,
    memos: tx.memos,
    expiresAt: expected.expiresAt,
    blockTimeMs: tx.blockTime === null ? null : tx.blockTime * 1000,
    txErr: tx.err != null,
    now: deps.now(),
  });
}

// ---------------------------------------------------------------------------------------
// Standalone file verification: one free per wallet and network per UTC day.
// ---------------------------------------------------------------------------------------

export async function verifyQuota(deps: Deps, user: Row | null, ipHashValue: string) {
  const config = await loadConfig(deps);
  const now = deps.now();
  const base = {
    freePerDay: config.verify_free_per_day,
    supplementLamports: config.verify_supplement_lamports,
    resetsAt: nextUtcDay(now),
  };
  if (!user) return { ...base, signedIn: false, freeLeft: false, paidCredits: 0 };
  const counts = await verifyCounts(deps.sql, user.id as string, ipHashValue, now);
  return {
    ...base,
    signedIn: true,
    freeLeft:
      config.verify_supplement_lamports === 0n ||
      freeVerificationLeft({ ...counts, freePerDay: config.verify_free_per_day }),
    paidCredits: counts.paidCredits,
  };
}

async function verifyCounts(sql: Sql, userId: string, ipHashValue: string, now: Date) {
  const dayStart = utcDayStart(now);
  const [row] = await sql<{ wallet: number; ip: number; credits: number }[]>`
    select
      (select count(*)::int from verifications where user_id = ${userId} and free and created_at >= ${dayStart}) as wallet,
      (select count(*)::int from verifications where ip_hash = ${ipHashValue} and free and created_at >= ${dayStart}) as ip,
      (select count(*)::int from supplements where user_id = ${userId} and kind = 'verify' and status = 'paid') as credits
  `;
  return {
    walletUsedToday: row?.wallet ?? 0,
    ipUsedToday: row?.ip ?? 0,
    paidCredits: row?.credits ?? 0,
  };
}

/**
 * Takes one verification from the free quota or from a paid supplement, atomically per
 * wallet. Throws 402 SUPPLEMENT_REQUIRED (with the amount) when neither is available.
 */
export async function consumeVerification(
  deps: Deps,
  user: Row,
  ipHashValue: string,
  supplementId: string | undefined,
): Promise<{ free: boolean }> {
  const config = await loadConfig(deps);
  return deps.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    await sql`select pg_advisory_xact_lock(hashtextextended(${'verify:' + user.id}, 0))`;
    const now = deps.now();
    const counts = await verifyCounts(sql, user.id as string, ipHashValue, now);
    const free =
      config.verify_supplement_lamports === 0n ||
      freeVerificationLeft({ ...counts, freePerDay: config.verify_free_per_day });
    if (free) {
      await sql`insert into verifications (user_id, ip_hash, free, created_at) values (${user.id}, ${ipHashValue}, true, ${now})`;
      return { free: true };
    }
    // A paid credit: the one named, else any paid and unused one the wallet holds.
    const [credit] = await sql<{ id: string }[]>`
      update supplements set status = 'used', used_at = ${now}
      where id = (
        select id from supplements
        where user_id = ${user.id} and kind = 'verify' and status = 'paid'
          and (${supplementId ?? null}::uuid is null or id = ${supplementId ?? null}::uuid)
        order by created_at asc limit 1
      )
      returning id
    `;
    if (!credit) {
      throw new HttpDataError(
        402,
        'SUPPLEMENT_REQUIRED',
        'your free verification for today is used; pay the supplement to verify another file',
        {
          supplement: {
            kind: 'verify',
            lamports: config.verify_supplement_lamports.toString(),
            reasons: ['verify_limit'],
            resetsAt: nextUtcDay(now).toISOString(),
          },
        },
      );
    }
    await sql`
      insert into verifications (user_id, ip_hash, free, supplement_id, created_at)
      values (${user.id}, ${ipHashValue}, false, ${credit.id}, ${now})
    `;
    return { free: false };
  });
}

export async function createVerifySupplement(deps: Deps, user: Row) {
  const config = await loadConfig(deps);
  const lamports = config.verify_supplement_lamports;
  if (lamports <= 0n) throw new HttpError(400, 'NO_SUPPLEMENT', 'verification is free right now');
  const id = randomUUID();
  const tx = await buildVaultTx(deps, user.wallet as string, lamports, supplementMemo(id));
  await deps.sql`
    insert into supplements (id, user_id, kind, lamports, memo, reasons, created_at)
    values (${id}, ${user.id}, 'verify', ${lamports}, ${supplementMemo(id)}, ${deps.sql.json(['verify_limit'] as never)}, ${deps.now()})
  `;
  return { supplementId: id, lamports, memo: supplementMemo(id), ...tx };
}

// ---------------------------------------------------------------------------------------
// Buyer updates: 30 free days, then monthly renewals priced by the seller.
// ---------------------------------------------------------------------------------------

/** Called when an order is paid: opens the free update window (or free-forever at price 0). */
export async function startUpdatePeriod(
  sql: Sql,
  config: AppConfig,
  order: Row,
  paid: Date,
): Promise<void> {
  const [listing] = await sql<
    { update_price: bigint }[]
  >`select update_price from listings where id = ${order.listing_id}`;
  if (!listing || listing.update_price === 0n) {
    await sql`update orders set updates_forever = true where id = ${order.id}`;
    return;
  }
  const until = new Date(paid.getTime() + config.update_free_days * 86_400_000);
  await sql`update orders set updates_until = ${until} where id = ${order.id}`;
  await sql`
    insert into update_periods (order_id, starts_at, ends_at, source) values (${order.id}, ${paid}, ${until}, 'purchase')
  `;
}

export type VersionView = {
  id: string;
  semver: string;
  changelog: string;
  liveAt: Date | null;
  status: string;
  entitled: boolean;
  purchased: boolean;
};

export type OrderUpdates = {
  purchased: { id: string; semver: string } | null;
  current: { id: string; semver: string } | null;
  latest: { id: string; semver: string; changelog: string } | null;
  latestEntitled: { id: string; semver: string } | null;
  updateAvailable: boolean;
  entitledToLatest: boolean;
  changes: { semver: string; changelog: string }[];
  updatesUntil: Date | null;
  forever: boolean;
  active: boolean;
  updatePrice: bigint;
  periodDays: number;
  versions: VersionView[];
};

/** Which versions this order may download, and what the Purchases page says about updates. */
export async function orderUpdates(
  deps: Deps,
  order: Row,
  config?: AppConfig,
): Promise<OrderUpdates> {
  const cfg = config ?? (await loadConfig(deps));
  const [listing] = await deps.sql<
    { update_price: bigint }[]
  >`select update_price from listings where id = ${order.listing_id}`;
  const periods = await deps.sql<{ starts_at: Date; ends_at: Date }[]>`
    select starts_at, ends_at from update_periods where order_id = ${order.id}
  `;
  const rows = await deps.sql<Row[]>`
    select id, semver, changelog, live_at, superseded_at, status, created_at from versions
    where listing_id = ${order.listing_id} and (status in ('live', 'superseded') or id = ${order.version_id})
  `;
  const downloaded = await deps.sql<{ version_id: string }[]>`
    select distinct version_id from downloads where order_id = ${order.id}
  `;
  const updatePrice = listing?.update_price ?? 0n;
  const forever = Boolean(order.updates_forever) || updatePrice === 0n;
  const rule = {
    purchasedVersionId: order.version_id as string,
    forever,
    periods: periods.map((p) => ({ startsAt: p.starts_at, endsAt: p.ends_at })),
  };
  const versions: VersionView[] = rows
    .map((row) => ({
      id: row.id as string,
      semver: row.semver as string,
      changelog: row.changelog as string,
      liveAt: (row.live_at as Date | null) ?? null,
      status: row.status as string,
      purchased: row.id === order.version_id,
      entitled: versionEntitled(
        {
          id: row.id as string,
          liveAt: (row.live_at as Date | null) ?? null,
          supersededAt: (row.superseded_at as Date | null) ?? null,
        },
        rule,
      ),
    }))
    .sort((a, b) => compareSemver(b.semver, a.semver));
  const purchased = versions.find((v) => v.purchased) ?? null;
  const latestRow = versions.find((v) => v.status === 'live') ?? null;
  const latestEntitled = versions.find((v) => v.entitled) ?? null;
  const seen = new Set(downloaded.map((row) => row.version_id));
  const current = versions.find((v) => v.entitled && seen.has(v.id)) ?? purchased;
  const updateAvailable =
    latestRow !== null && current !== null && compareSemver(latestRow.semver, current.semver) > 0;
  const changes = current
    ? versions
        .filter((v) => compareSemver(v.semver, current.semver) > 0 && v.status !== 'delisted')
        .slice(0, 5)
        .map((v) => ({ semver: v.semver, changelog: v.changelog }))
    : [];
  const updatesUntil = (order.updates_until as Date | null) ?? null;
  return {
    purchased: purchased ? { id: purchased.id, semver: purchased.semver } : null,
    current: current ? { id: current.id, semver: current.semver } : null,
    latest: latestRow
      ? { id: latestRow.id, semver: latestRow.semver, changelog: latestRow.changelog }
      : null,
    latestEntitled: latestEntitled
      ? { id: latestEntitled.id, semver: latestEntitled.semver }
      : null,
    updateAvailable,
    entitledToLatest: latestRow !== null && latestRow.entitled,
    changes,
    updatesUntil,
    forever,
    active: updatesActive({ forever, updatesUntil, now: deps.now() }),
    updatePrice,
    periodDays: cfg.update_period_days,
    versions,
  };
}

/** The version a download serves: the one asked for if entitled, else the newest entitled. */
export function pickDownload(updates: OrderUpdates, versionId: string | undefined): string {
  if (versionId) {
    const asked = updates.versions.find((v) => v.id === versionId || v.semver === versionId);
    if (!asked) throw new HttpError(404, 'NOT_FOUND', 'version not found for this listing');
    if (!asked.entitled) {
      throw new HttpError(
        403,
        'NOT_ENTITLED',
        'this version was released after your updates ended; renew updates to download it',
      );
    }
    return asked.id;
  }
  const best = updates.latestEntitled ?? updates.purchased;
  if (!best) throw new HttpError(404, 'NOT_FOUND', 'version missing');
  return best.id;
}

function assertRenewable(order: Row, listing: Row | undefined) {
  if (!['paid', 'released'].includes(order.status as string)) {
    throw new HttpError(400, 'NOT_RENEWABLE', 'updates can be renewed on paid orders only');
  }
  if (!listing || listing.delisted_at) throw new HttpError(400, 'NOT_LIVE', 'listing is not live');
  if (order.updates_forever || (listing.update_price as bigint) === 0n) {
    throw new HttpError(400, 'FREE_UPDATES', 'updates for this listing are free');
  }
}

export async function renewalQuoteFor(deps: Deps, order: Row, wallet: string) {
  const config = await loadConfig(deps);
  const [listing] = await deps.sql<Row[]>`select * from listings where id = ${order.listing_id}`;
  assertRenewable(order, listing);
  const tier = await tierForWallet(deps, wallet, config);
  const rebateBps = config.tier_rebate_bps[tier.tier];
  const priced = renewalQuote(listing!.update_price as bigint, config.fee_bps, rebateBps);
  const window = renewalWindow(
    deps.now(),
    (order.updates_until as Date | null) ?? null,
    config.update_period_days,
  );
  return {
    ...priced,
    tier: tier.tier,
    feeBps: config.fee_bps,
    rebateBps,
    ...window,
    periodDays: config.update_period_days,
    config,
    listing: listing!,
  };
}

export async function createRenewal(deps: Deps, order: Row, buyer: Row) {
  const q = await renewalQuoteFor(deps, order, buyer.wallet as string);
  const id = randomUUID();
  const memo = renewalMemo(id);
  const tx = await buildVaultTx(deps, buyer.wallet as string, q.total, memo);
  const expires = new Date(deps.now().getTime() + q.config.order_ttl_minutes * 60_000);
  await deps.sql`
    insert into update_renewals (id, order_id, buyer_id, price, fee_bps, rebate_bps, fee, rebate, total, tier, memo, expires_at, created_at)
    values (${id}, ${order.id}, ${buyer.id}, ${q.price}, ${q.feeBps}, ${q.rebateBps}, ${q.fee}, ${q.rebate}, ${q.total},
      ${q.tier}::tier, ${memo}, ${expires}, ${deps.now()})
  `;
  return {
    renewalId: id,
    memo,
    price: q.price,
    fee: q.fee,
    rebate: q.rebate,
    total: q.total,
    periodDays: q.periodDays,
    vault: deps.env.vaultAddress,
    ...tx,
  };
}

/**
 * Verifies the renewal transfer, then extends updates by one period from
 * max(payment time, current expiry). The seller is paid the update price and the net fee is
 * split like a sale's, through the vault payout batch.
 */
export async function settleRenewal(
  deps: Deps,
  renewalId: string,
  buyer: Row,
  txSig: string,
): Promise<Settled> {
  const [renewal] = await deps.sql<Row[]>`
    select * from update_renewals where id = ${renewalId} and buyer_id = ${buyer.id}
  `;
  if (!renewal) return { ok: false, code: 'NOT_FOUND', message: 'renewal not found' };
  if (renewal.status === 'paid' && renewal.tx_sig === txSig) return { ok: true };
  if (renewal.status !== 'pending')
    return { ok: false, code: 'NOT_PENDING', message: 'renewal is not pending' };
  const tx = await deps.getTx(txSig);
  if (!tx) return { ok: false, code: 'TX_NOT_FOUND', message: 'transaction not found' };
  const assessment = vaultPayment(deps, tx, {
    lamports: renewal.total as bigint,
    memo: renewal.memo as string,
    source: buyer.wallet as string,
    expiresAt: renewal.expires_at as Date,
  });
  if (!assessment.ok) {
    if (assessment.code === 'WRONG_AMOUNT' || assessment.code === 'WRONG_MEMO') {
      await audit(
        deps.sql,
        buyer.id as string,
        'renewal',
        renewalId,
        'payment_mismatch',
        assessment,
      );
    }
    return assessment;
  }
  const used = await deps.sql`
    select 1 from update_renewals where tx_sig = ${txSig}
    union all select 1 from supplements where tx_sig = ${txSig}
    union all select 1 from orders where tx_sig = ${txSig}
  `;
  if (used.length > 0)
    return { ok: false, code: 'DUPLICATE_SIG', message: 'signature already used' };
  const config = await loadConfig(deps);
  const at = paidAt(deps, tx);
  const result = await deps.sql.begin(async (t) => {
    const sql = t as unknown as Sql;
    const [order] = await sql<
      Row[]
    >`select * from orders where id = ${renewal.order_id} for update`;
    if (!order) return null;
    const window = renewalWindow(
      at,
      (order.updates_until as Date | null) ?? null,
      config.update_period_days,
    );
    const updated = await sql`
      update update_renewals set status = 'paid', tx_sig = ${txSig}, paid_at = ${at},
        starts_at = ${window.startsAt}, ends_at = ${window.endsAt}
      where id = ${renewalId} and status = 'pending' returning id
    `;
    if (updated.length === 0) return null;
    await sql`update orders set updates_until = ${window.endsAt} where id = ${order.id}`;
    await sql`
      insert into update_periods (order_id, starts_at, ends_at, source, renewal_id)
      values (${order.id}, ${window.startsAt}, ${window.endsAt}, 'renewal', ${renewalId})
    `;
    return { order, window };
  });
  if (!result) return { ok: false, code: 'NOT_PENDING', message: 'renewal is not pending' };
  const [seller] = await deps.sql<{ id: string; wallet: string }[]>`
    select u.id, u.wallet from listings l join users u on u.id = l.creator_id where l.id = ${result.order.listing_id}
  `;
  const lines = releasePayouts({
    price: renewal.price as bigint,
    netFee: (renewal.fee as bigint) - (renewal.rebate as bigint),
    splitBps: config.fee_split_bps,
    creatorWallet: seller?.wallet ?? 'UNCONFIGURED:creator',
    buckets: deps.env.buckets,
  });
  for (const line of lines) {
    await deps.sql`
      insert into payouts (order_id, recipient, bucket, amount) values (${result.order.id}, ${line.recipient}, ${line.bucket}, ${line.amount})
    `;
  }
  await deps.sql`
    insert into ledger (account, delta, ref_type, ref_id) values ('vault', ${renewal.total}, 'renewal', ${renewalId})
  `;
  if (seller) {
    await deps.sql`
      insert into ledger (account, delta, ref_type, ref_id) values (${'creator:' + seller.id}, ${renewal.price}, 'renewal', ${renewalId})
    `;
  }
  await audit(deps.sql, buyer.id as string, 'renewal', renewalId, 'paid', {
    txSig,
    endsAt: result.window.endsAt.toISOString(),
  });
  return { ok: true };
}

export function suggestedUpdatePrice(price: bigint, config: AppConfig): bigint {
  return defaultUpdatePrice(price, config.update_price_default_bps);
}
