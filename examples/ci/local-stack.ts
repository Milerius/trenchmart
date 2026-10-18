/**
 * Local devnet-like stack for CI: a solana-test-validator running the escrow program, the API
 * on Postgres, and the example agents against both. Nothing here touches a public cluster.
 *
 *   tsx ci/local-stack.ts keys <dir>   generate the stack's keypairs (before the validator starts)
 *   tsx ci/local-stack.ts init <dir>   fund them, create the escrow config, write <dir>/api.env
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID ?? 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw');
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const RPC = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const NAMES = ['authority', 'resolver', 'crank', 'vault', 'buyback', 'ai', 'ops', 'safety', 'creator', 'buyer'] as const;
type Name = (typeof NAMES)[number];

const [command, dir] = process.argv.slice(2);
if (!dir || (command !== 'keys' && command !== 'init')) {
  console.error('usage: local-stack.ts keys|init <dir>');
  process.exit(2);
}

function keyPath(name: Name) {
  return join(dir!, `${name}.json`);
}

function load(name: Name): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath(name), 'utf8')) as number[]));
}

if (command === 'keys') {
  mkdirSync(dir, { recursive: true });
  for (const name of NAMES) {
    if (!existsSync(keyPath(name))) writeFileSync(keyPath(name), JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  }
  console.log(`keys ready in ${dir} (authority ${load('authority').publicKey.toBase58()})`);
  process.exit(0);
}

const connection = new Connection(RPC, 'confirmed');
const keys = Object.fromEntries(NAMES.map((name) => [name, load(name)])) as Record<Name, Keypair>;

for (const name of NAMES) {
  const sol = name === 'creator' || name === 'buyer' || name === 'authority' ? 20 : 2;
  const sig = await connection.requestAirdrop(keys[name].publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
}

// init_config(resolver, dispute_timeout): signed by the program's upgrade authority.
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], ESCROW_PROGRAM_ID);
if (!(await connection.getAccountInfo(config))) {
  const [programData] = PublicKey.findProgramAddressSync([ESCROW_PROGRAM_ID.toBuffer()], LOADER);
  const timeout = Buffer.alloc(8);
  timeout.writeBigInt64LE(3_600n);
  const data = Buffer.concat([
    createHash('sha256').update('global:init_config').digest().subarray(0, 8),
    keys.resolver.publicKey.toBuffer(),
    timeout,
  ]);
  const ix = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: keys.authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keys.authority], { commitment: 'confirmed' });
}

const secret = (name: Name) => bs58.encode(keys[name].secretKey);
const env = {
  SOLANA_CLUSTER: 'localnet',
  SOLANA_RPC_URL: RPC,
  API_URL: 'http://127.0.0.1:8787',
  APP_URL: 'http://127.0.0.1:3000',
  SESSION_SECRET: bs58.encode(crypto.getRandomValues(new Uint8Array(32))),
  INTERNAL_TOKEN: bs58.encode(crypto.getRandomValues(new Uint8Array(24))),
  VAULT_ADDRESS: keys.vault.publicKey.toBase58(),
  BUCKET_WALLET_BUYBACK: keys.buyback.publicKey.toBase58(),
  BUCKET_WALLET_AI_VERIFICATION: keys.ai.publicKey.toBase58(),
  BUCKET_WALLET_OPS: keys.ops.publicKey.toBase58(),
  BUCKET_WALLET_SAFETY: keys.safety.publicKey.toBase58(),
  ESCROW_PROGRAM_ID: ESCROW_PROGRAM_ID.toBase58(),
  ESCROW_PROGRAM_VERSION: '2',
  ESCROW_RESOLVER: keys.resolver.publicKey.toBase58(),
  ESCROW_RESOLVER_SECRET: secret('resolver'),
  ESCROW_CRANK_SECRET: secret('crank'),
  // About 2-minute escrow window (longer than the 1-minute order TTL CI sets) so the buyer
  // agent can release and review within the job.
  ESCROW_HOURS_OVERRIDE: '0.03',
  SOL_USD_OVERRIDE: '150',
  BLOB_DIR: join(dir, 'blobs'),
};
writeFileSync(
  join(dir, 'api.env'),
  Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
  { mode: 0o600 },
);
console.log(`stack ready: config ${config.toBase58()}, env in ${join(dir, 'api.env')}`);
