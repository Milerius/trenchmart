import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createSql(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 10,
    prepare: false,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
  });
}

export type Sql = ReturnType<typeof createSql>;
export type Db = PostgresJsDatabase<typeof schema>;

export function createOrm(sql: Sql): Db {
  return drizzle(sql, { schema });
}
