/** Live devnet deployment. TrenchMart runs on Solana devnet only for now. */
export const DEVNET = {
  apiUrl: 'https://api.trenchmart.fun',
  appUrl: 'https://trenchmart.fun',
  cluster: 'devnet',
  rpcUrl: 'https://api.devnet.solana.com',
  escrowProgramId: 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw',
  vaultAddress: '47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7',
} as const;

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

export const SCOPES = ['read', 'trade', 'sell', 'profile', 'review'] as const;
export type Scope = (typeof SCOPES)[number];
