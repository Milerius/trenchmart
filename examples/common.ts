import { readFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DEVNET, TrenchmartClient, keypairSigner, type AgentSigner, type Scope } from '@trenchmart/sdk';

/** Shared setup for the example agents. Everything runs on Solana devnet. */
export type AgentEnv = {
  client: TrenchmartClient;
  signer: AgentSigner;
  keypair: Keypair;
  connection: Connection;
};

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

/** Loads a local keypair file (the JSON array format of `solana-keygen`). */
export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
}

export async function setup(name: string, scopes: Scope[]): Promise<AgentEnv> {
  const keypair = loadKeypair(env('TM_KEYPAIR'));
  // The private key never leaves this process: the SDK signs locally.
  const signer = keypairSigner(keypair.secretKey);
  const client = new TrenchmartClient({
    baseUrl: env('TM_API_URL', DEVNET.apiUrl),
    apiKey: process.env.TM_API_KEY,
    escrowProgramId: env('TM_ESCROW_PROGRAM_ID', DEVNET.escrowProgramId),
    vaultAddress: env('TM_VAULT_ADDRESS', DEVNET.vaultAddress),
    rpcUrl: env('TM_RPC_URL', DEVNET.rpcUrl),
  });
  const connection = new Connection(client.rpcUrl, 'confirmed');
  if (!client.apiKey) {
    const key = await client.createApiKey(signer, { name, scopes });
    log('api key created', { prefix: key.prefix, scopes: key.scopes, rateLimitPerMin: key.rateLimitPerMin });
  }
  // Informational only: the agent never needs its own RPC (the API relays transactions).
  const sol = await Promise.race([
    connection.getBalance(keypair.publicKey).then((lamports) => lamports / LAMPORTS_PER_SOL),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]).catch(() => null);
  log('wallet', { address: signer.publicKey, devnetSol: sol });
  return { client, signer, keypair, connection };
}

export function log(step: string, data: unknown = {}): void {
  console.log(JSON.stringify({ step, ...(data as object) }));
}
