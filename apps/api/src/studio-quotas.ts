/**
 * API abuse limits (docs/04-api.md "Abuse limits"): sign-in nonce caps, request body caps,
 * and per-user Studio quotas (daily versions, daily scan runs, stored bytes and objects).
 * Every limit here is a hard cap: unlike the daily free upload limit it cannot be paid past.
 */
import type { Sql } from '@trenchmart/db';
import { HttpError, type Deps } from './logic';

/** Open (unused, unexpired) sign-in nonces kept per wallet; older ones are dropped. */
export const NONCE_OPEN_MAX = 5;
/** POST /auth/nonce per client IP per minute: limits.ts authNonce (AUTH_NONCE_LIMITER). */
export const NONCE_RATE_PER_MIN = 20;
/** Postgres fallback (no binding): a sixth of the write limit, 20 at the default 120. */
export const nonceFallbackLimit = (rateLimitPerMin: number) =>
  Math.max(1, Math.ceil(rateLimitPerMin / 6));

/** Every request body outside the upload routes. */
export const BODY_MAX_BYTES = 1024 * 1024;
/** Base64 length of the largest file /verify accepts (25 MiB, the setup category limit). */
export const VERIFY_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const VERIFY_MAX_BASE64 = Math.ceil(VERIFY_MAX_FILE_BYTES / 3) * 4;
/** JSON envelope around the base64 (file name, supplement id). */
const JSON_SLACK = 64 * 1024;
/** Reupload JSON: reuploadBody caps contentBase64 at 20,000,000 chars. */
const REUPLOAD_MAX_BYTES = 20_000_000 + JSON_SLACK;
/** Sandbox runner results (internal token only): logs and findings. */
const SANDBOX_RESULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Body cap for one request. Upload routes return their own larger cap, or null when the
 * handler streams the body through its own (config-driven) cap.
 */
export function bodyLimitFor(method: string, path: string): number | null {
  const p = path.startsWith('/api/v1/') ? path.slice('/api/v1'.length) : path;
  if (method === 'PUT' && p === '/files') return null; // signed PUT, capped by max_file_bytes
  if (method === 'POST' && /^\/studio\/listings\/[^/]+\/images$/.test(p)) return null;
  if (method === 'PUT' && /^\/studio\/listings\/[^/]+\/images\/[^/]+\/w\/[^/]+$/.test(p))
    return null;
  if (method === 'POST' && /^\/studio\/profile\/(avatar|banner)$/.test(p)) return null;
  if (method === 'POST' && p === '/verify') return VERIFY_MAX_BASE64 + JSON_SLACK;
  if (method === 'POST' && /^\/studio\/versions\/[^/]+\/reupload$/.test(p))
    return REUPLOAD_MAX_BYTES;
  if (method === 'POST' && /^\/internal\/sandbox\/[^/]+\/result$/.test(p))
    return SANDBOX_RESULT_MAX_BYTES;
  return BODY_MAX_BYTES;
}

export function bodyTooLarge(max: number): HttpError {
  return new HttpError(413, 'BODY_TOO_LARGE', `request body is limited to ${max} bytes`);
}

/** Rejects a declared content-length over the cap before anything reads the body. */
export function assertDeclaredLength(header: string | undefined, max: number): void {
  if (header === undefined) return;
  const declared = Number(header);
  if (!Number.isFinite(declared) || declared < 0)
    throw new HttpError(400, 'BAD_REQUEST', 'invalid content-length');
  if (declared > max) throw bodyTooLarge(max);
}

// ---------------------------------------------------------------------------------------
// Studio: hard per-user caps.
// ---------------------------------------------------------------------------------------

/** New versions per creator per UTC day, across listings (5 are free, the rest paid). */
export const STUDIO_VERSIONS_PER_USER_DAY = 20;
/** Scan runs (complete, review, reupload) per creator per UTC day. */
export const STUDIO_SCANS_PER_USER_DAY = 60;
/** Bytes stored in R2 per creator: version files plus listing images. */
export const STORAGE_BYTES_PER_USER = 2 * 1024 * 1024 * 1024;
/** Objects stored in R2 per creator: version files plus listing images. */
export const STORAGE_OBJECTS_PER_USER = 1000;
export const SCAN_RUN_ACTION = 'version.scan_run';

const utcDayStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function studioUsage(sql: Sql, userId: string, now: Date) {
  const day = utcDayStart(now);
  const [row] = await sql<{ versions: number; scans: number; bytes: string; objects: number }[]>`
    select
      (select count(*)::int from versions v join listings l on l.id = v.listing_id
        where l.creator_id = ${userId} and v.created_at >= ${day}) as versions,
      (select count(*)::int from audit_log
        where actor_id = ${userId} and action = ${SCAN_RUN_ACTION} and ts >= ${day}) as scans,
      ((select coalesce(sum(v.file_size), 0) from versions v join listings l on l.id = v.listing_id
          where l.creator_id = ${userId})
        + (select coalesce(sum(m.bytes), 0) from listing_media m join listings l on l.id = m.listing_id
          where l.creator_id = ${userId}))::text as bytes,
      ((select count(*) from versions v join listings l on l.id = v.listing_id
          where l.creator_id = ${userId})
        + (select count(*) from listing_media m join listings l on l.id = m.listing_id
          where l.creator_id = ${userId}))::int as objects
  `;
  return {
    versionsToday: row?.versions ?? 0,
    scansToday: row?.scans ?? 0,
    storedBytes: Number(row?.bytes ?? 0),
    storedObjects: row?.objects ?? 0,
    limits: {
      versionsPerDay: STUDIO_VERSIONS_PER_USER_DAY,
      scansPerDay: STUDIO_SCANS_PER_USER_DAY,
      storageBytes: STORAGE_BYTES_PER_USER,
      storageObjects: STORAGE_OBJECTS_PER_USER,
    },
  };
}

/** Throws 429/413 when one more version (of `addBytes`) would pass a per-user cap. */
export async function assertVersionQuota(sql: Sql, userId: string, now: Date, addBytes: number) {
  const usage = await studioUsage(sql, userId, now);
  if (usage.versionsToday >= STUDIO_VERSIONS_PER_USER_DAY)
    throw new HttpError(
      429,
      'DAILY_VERSION_CAP',
      `at most ${STUDIO_VERSIONS_PER_USER_DAY} new versions per day; try again after 00:00 UTC`,
    );
  assertStorage(usage, addBytes);
}

export function assertStorage(
  usage: { storedBytes: number; storedObjects: number },
  addBytes: number,
) {
  if (usage.storedObjects + 1 > STORAGE_OBJECTS_PER_USER)
    throw new HttpError(
      413,
      'STORAGE_QUOTA',
      `storage is limited to ${STORAGE_OBJECTS_PER_USER} files per creator; remove old images or versions`,
    );
  if (usage.storedBytes + addBytes > STORAGE_BYTES_PER_USER)
    throw new HttpError(413, 'STORAGE_QUOTA', 'storage is limited to 2 GB per creator');
}

/** Image uploads: storage quota only (images are not versions). */
export async function assertImageQuota(sql: Sql, userId: string, now: Date, addBytes: number) {
  assertStorage(await studioUsage(sql, userId, now), addBytes);
}

/**
 * Counts one scan run against the creator's daily cap, or throws 429 when it is used up.
 * Serialized per creator so parallel calls cannot overshoot.
 */
export async function takeScanRun(deps: Deps, userId: string, versionId: string): Promise<void> {
  await deps.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    await sql`select pg_advisory_xact_lock(hashtextextended(${'scans:' + userId}, 0))`;
    const now = deps.now();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where actor_id = ${userId} and action = ${SCAN_RUN_ACTION} and ts >= ${utcDayStart(now)}
    `;
    if ((row?.n ?? 0) >= STUDIO_SCANS_PER_USER_DAY)
      throw new HttpError(
        429,
        'DAILY_SCAN_CAP',
        `at most ${STUDIO_SCANS_PER_USER_DAY} scans per day; try again after 00:00 UTC`,
      );
    await sql`
      insert into audit_log (ts, actor_id, entity, entity_id, action)
      values (${now}, ${userId}, 'version', ${versionId}, ${SCAN_RUN_ACTION})
    `;
  });
}

/** Cron: expired sign-in nonces are useless (used ones too, after expiry). */
export async function pruneAuthNonces(deps: Deps): Promise<number> {
  const rows =
    await deps.sql`delete from auth_nonces where expires_at < ${deps.now()} returning nonce`;
  return rows.length;
}
