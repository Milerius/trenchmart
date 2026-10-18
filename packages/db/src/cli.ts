import { createSql } from './client';
import { migrate } from './migrate';
import { pendingMigrations } from './migrations-list';
import { managementQuery, migrateRemote, pendingRemote } from './remote';
import { seed } from './seed';

// DATABASE_URL talks to Postgres directly. Without it, SUPABASE_ACCESS_TOKEN +
// SUPABASE_PROJECT_REF use the Supabase Management API (machines that cannot reach the pooler).
//   migrate  apply every pending migration (each file + its schema_migrations row)
//   pending  list migrations in the repo not applied to the database; exit 1 if any
//   seed     migrate, then load the sample catalogue (DATABASE_URL only)
const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;

function report(pending: string[]) {
  if (pending.length === 0) {
    console.log('database is up to date with the repo migrations');
    return;
  }
  console.error(`PENDING migrations not applied to this database: ${pending.join(', ')}`);
  console.error('run `pnpm db:migrate` against it before deploying the API');
  process.exitCode = 1;
}

if (command !== 'migrate' && command !== 'pending' && command !== 'seed') {
  console.error('usage: cli.ts migrate|pending|seed');
  process.exit(1);
}

if (!databaseUrl && token && projectRef && command !== 'seed') {
  const query = managementQuery(token, projectRef);
  if (command === 'migrate') {
    const applied = await migrateRemote(query);
    console.log(applied.length ? `applied ${applied.join(', ')}` : 'migrations up to date');
    report(await pendingRemote(query));
  } else {
    report(await pendingRemote(query));
  }
} else {
  if (!databaseUrl) {
    console.error('DATABASE_URL (or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF) is required');
    process.exit(1);
  }
  const sql = createSql(databaseUrl);
  try {
    if (command === 'migrate') {
      const applied = await migrate(sql);
      console.log(applied.length ? `applied ${applied.join(', ')}` : 'migrations up to date');
    } else if (command === 'pending') {
      report(await pendingMigrations(sql));
    } else {
      await migrate(sql);
      const blobDir = process.env.BLOB_DIR ?? '.data/blobs';
      const secret = process.env.AI_ATTEST_SECRET ?? 'change-me';
      await seed(sql, blobDir, secret);
      console.log('seeded catalogue');
    }
  } finally {
    await sql.end();
  }
}
