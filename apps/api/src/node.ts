import { serve } from '@hono/node-server';
import { createSql } from '@trenchmart/db';
import {
  accountData,
  fetchTransaction,
  latestBlockhash,
  simulateUnsigned,
  sendAndConfirm,
} from '@trenchmart/chain';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';

const env = readEnv();
if (!env.sessionSecret) throw new Error('SESSION_SECRET is required');
const sql = createSql(
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
);
const blob = filesystemBlob(env.blobDir, env.sessionSecret, env.apiUrl);
const app = createApp({
  sql,
  blob,
  env,
  now: () => new Date(),
  getTx: (signature) => fetchTransaction(env.rpcUrl, signature),
  blockhash: () => latestBlockhash(env.rpcUrl),
  simulate: (tx) => simulateUnsigned(env.rpcUrl, tx),
  escrowChain: {
    account: (address) => accountData(env.rpcUrl, address),
    sendAndConfirm: (tx) => sendAndConfirm(env.rpcUrl, tx),
  },
});

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`api listening on ${port} (${env.cluster})`);
});
