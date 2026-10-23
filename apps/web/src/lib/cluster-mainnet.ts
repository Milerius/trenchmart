import type { ClusterConfig } from './cluster-types';

// Mainnet addresses (deployed 2026-10-23). The $MART mint is injected at build time from
// NEXT_PUBLIC_MART_MINT and is never committed; rewards limit/wallet are set at launch.
export const MAINNET: ClusterConfig = {
  id: 'mainnet',
  label: 'Mainnet',
  chain: 'solana:mainnet',
  explorerCluster: '',
  escrowProgramId: 'Dm2jtJDfSji2TASEGKxsY1CwxeUCXqGznefkJpSASZLp',
  multisig: 'FFsRpwj5aTteCsS9kWpUAyQ7a9KzSSbDZgwgq2JdqbsN',
  vault: 'AoK6JdJQgtW9Wrt2z47gHnNMju2RrwNRhTZon13K3kf1',
  martMint: process.env.NEXT_PUBLIC_MART_MINT || 'VAYdSoVF9j7RXgPz6wwELsFNPqortx3iXEXVXHpMART',
  rewardsVault: 'HgR2hVhSNv6YacZ8fwjbFt3WudZauYQABn3sNHaiEM7y',
  rewardsSpendingLimit: '',
  rewardsWallet: '',
};
