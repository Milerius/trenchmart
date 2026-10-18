import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, RENAMED_MIGRATIONS } from './migrations-list';
import { migrateRemote, pendingRemote, type Query } from './remote';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const files = async () => (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

/** Fake Management API: answers `select id from schema_migrations` from `applied`. */
function fakeQuery(applied: string[]) {
  const seen: string[] = [];
  const query: Query = async (q) => {
    seen.push(q);
    if (q === 'select id from schema_migrations') return applied.map((id) => ({ id }));
    for (const m of q.matchAll(/set id = '([^']+)' where id = '([^']+)'/g)) {
      const at = applied.indexOf(m[2]!);
      if (at >= 0 && !applied.includes(m[1]!)) applied[at] = m[1]!;
    }
    const insert = /insert into schema_migrations \(id\) values \('([^']+)'\)/.exec(q);
    if (insert) applied.push(insert[1]!);
    return [];
  };
  return { query, seen };
}

describe('migrations', () => {
  it('MIGRATIONS lists every migration file in apply order', async () => {
    expect([...MIGRATIONS]).toEqual(await files());
  });

  it('every migration has its own number', async () => {
    const numbers = (await files()).map((file) => file.split('_')[0]);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^\d{4}$/);
  });

  it('renamed files point at an old id that is no longer a file', async () => {
    const all = await files();
    for (const [to, from] of Object.entries(RENAMED_MIGRATIONS)) {
      expect(all).toContain(to);
      expect(all).not.toContain(from);
    }
  });

  it('remote: pending is what the database lacks, counting a renamed file under its old id', async () => {
    const live = MIGRATIONS.filter((id) => !id.startsWith('002') && id !== '0013_profiles.sql');
    const { query } = fakeQuery([...live, '0011_profiles.sql']);
    expect(await pendingRemote(query)).toEqual(['0020_reviews.sql', '0021_upvotes_ranking.sql']);
  });

  it('remote: migrate runs each pending file with its schema_migrations row in one query', async () => {
    const live = MIGRATIONS.filter((id) => !id.startsWith('002') && id !== '0013_profiles.sql');
    const applied = [...live, '0011_profiles.sql'];
    const { query, seen } = fakeQuery(applied);
    // 0011_profiles.sql is carried over to 0013_profiles.sql, not run again.
    const ran = await migrateRemote(query);
    expect(ran).toEqual(['0020_reviews.sql', '0021_upvotes_ranking.sql']);
    expect(applied).toContain('0013_profiles.sql');
    expect(applied).not.toContain('0011_profiles.sql');
    expect(
      seen.some((q) => q.includes("set id = '0013_profiles.sql' where id = '0011_profiles.sql'")),
    ).toBe(true);
    const reviews = seen.find((q) => q.includes("values ('0020_reviews.sql')"))!;
    expect(reviews).toContain('alter table listing_reviews add column if not exists hidden_at');
    expect(seen.at(-1)).toContain('enable row level security');
  });
});
