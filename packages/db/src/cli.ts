import { createSql } from './client';
import { migrate } from './migrate';
import { seed } from './seed';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const sql = createSql(databaseUrl);
const command = process.argv[2];

try {
  if (command === 'migrate') {
    const applied = await migrate(sql);
    console.log(applied.length ? `applied ${applied.join(', ')}` : 'migrations up to date');
  } else if (command === 'seed') {
    await migrate(sql);
    const blobDir = process.env.BLOB_DIR ?? '.data/blobs';
    const secret = process.env.AI_ATTEST_SECRET ?? 'change-me';
    await seed(sql, blobDir, secret);
    console.log('seeded catalogue');
  } else {
    console.error('usage: cli.ts migrate|seed');
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
