import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client';
import { RENAMED_MIGRATIONS } from './migrations-list';

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  for (const [to, from] of Object.entries(RENAMED_MIGRATIONS)) {
    await sql`
      update schema_migrations set id = ${to} where id = ${from}
        and not exists (select 1 from schema_migrations where id = ${to})
    `;
  }
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const existing = await sql`select id from schema_migrations where id = ${file}`;
    if (existing.length > 0) continue;
    const body = await readFile(join(dir, file), 'utf8');
    const statements = splitStatements(body);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
    await sql`insert into schema_migrations (id) values (${file})`;
    applied.push(file);
  }
  await enableRowLevelSecurity(sql);
  return applied;
}

/** Statements of a migration file (split on `;` at a line end, comment-only parts dropped). */
export function splitStatements(body: string): string[] {
  return body
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.replace(/--.*$/gm, '').trim().length > 0);
}

// Supabase exposes the public schema through PostgREST, where the anon key can read and
// write any table without row level security. The API talks to Postgres directly as the
// table owner (which bypasses RLS), so every public table gets RLS on with no policies.
// This runs after every migrate, so tables added by later migrations are covered too.
export async function enableRowLevelSecurity(sql: Sql): Promise<void> {
  await sql`
    do $$
    declare t record;
    begin
      for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
        execute format('alter table public.%I enable row level security', t.tablename);
      end loop;
    end
    $$
  `;
}
