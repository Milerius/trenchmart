import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client';

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const existing = await sql`select id from schema_migrations where id = ${file}`;
    if (existing.length > 0) continue;
    const body = await readFile(join(dir, file), 'utf8');
    const statements = body
      .split(/;\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part.replace(/--.*$/gm, '').trim().length > 0);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
    await sql`insert into schema_migrations (id) values (${file})`;
    applied.push(file);
  }
  return applied;
}
