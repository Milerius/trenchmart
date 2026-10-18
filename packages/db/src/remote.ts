import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS, RENAMED_MIGRATIONS, renameMigrationsSql } from './migrations-list';

/**
 * Migrations through the Supabase Management API (`POST /v1/projects/{ref}/database/query`),
 * for machines that cannot reach the Postgres pooler. Each file runs together with its
 * schema_migrations row in one query, so a file is applied fully or not at all.
 */
export type Query = (query: string) => Promise<Record<string, unknown>[]>;

export function managementQuery(token: string, projectRef: string, f: typeof fetch = fetch): Query {
  return async (query) => {
    const res = await f(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase query failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>[]) : [];
  };
}

const ENSURE_TABLE = `create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
)`;

const ENABLE_RLS = `do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$`;

export async function pendingRemote(query: Query): Promise<string[]> {
  await query(ENSURE_TABLE);
  const rows = await query('select id from schema_migrations');
  const applied = new Set(rows.map((row) => String(row.id)));
  // A renamed file counts as applied under its old id too.
  return MIGRATIONS.filter((id) => !applied.has(id) && !applied.has(RENAMED_MIGRATIONS[id] ?? ''));
}

export async function migrateRemote(query: Query): Promise<string[]> {
  await query(ENSURE_TABLE);
  await query(renameMigrationsSql());
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const rows = await query('select id from schema_migrations');
  const done = new Set(rows.map((row) => String(row.id)));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const body = (await readFile(join(dir, file), 'utf8')).trimEnd();
    const id = file.replace(/'/g, "''");
    await query(
      `${body}\n;\ninsert into schema_migrations (id) values ('${id}') on conflict do nothing;`,
    );
    applied.push(file);
  }
  await query(ENABLE_RLS);
  return applied;
}
