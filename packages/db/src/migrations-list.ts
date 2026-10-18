import type { Sql } from './client';

/**
 * Every file in packages/db/migrations, in apply order. The Worker cannot read the directory,
 * so the release it ships carries this list and compares it with schema_migrations
 * (see pendingMigrations). migrations-list.test.ts fails CI when a file is not listed here.
 */
export const MIGRATIONS = [
  '0001_init.sql',
  '0002_resume_step.sql',
  '0003_order_escrow.sql',
  '0004_listing_content.sql',
  '0005_review_engine.sql',
  '0006_tier_thresholds.sql',
  '0007_terminals.sql',
  '0008_escrow_one_hour.sql',
  '0009_escrow_v2.sql',
  '0010_versioning.sql',
  '0011_ops.sql',
  '0012_listing_kinds.sql',
  '0013_profiles.sql',
  '0020_reviews.sql',
  '0021_upvotes_ranking.sql',
  '0022_featuring.sql',
  '0023_wallet_count.sql',
  '0030_agent_api.sql',
] as const;

/**
 * Files renamed after they were applied somewhere: new id -> old id. migrate() rewrites the
 * old schema_migrations row so the file is not run twice. 0011_profiles.sql shared its number
 * with 0011_ops.sql; it does not depend on 0012 (or 0012 on it), so it moved to 0013.
 */
export const RENAMED_MIGRATIONS: Readonly<Record<string, string>> = {
  '0013_profiles.sql': '0011_profiles.sql',
};

/** SQL that carries renamed rows over to their new id (no-op on a fresh database). */
export function renameMigrationsSql(): string {
  return Object.entries(RENAMED_MIGRATIONS)
    .map(
      ([to, from]) =>
        `update schema_migrations set id = '${to}' where id = '${from}' and not exists (select 1 from schema_migrations where id = '${to}');`,
    )
    .join('\n');
}

/** Migrations this release expects that the database has not applied, in apply order. */
export async function pendingMigrations(sql: Sql): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`select id from schema_migrations`;
  const applied = new Set(rows.map((row) => row.id));
  // A renamed file counts as applied under its old id too (until migrate() rewrites the row).
  return MIGRATIONS.filter((id) => !applied.has(id) && !applied.has(RENAMED_MIGRATIONS[id] ?? ''));
}
