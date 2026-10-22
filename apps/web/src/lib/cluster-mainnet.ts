import type { ClusterConfig } from './cluster-types';

// Not deployed yet: the addresses stay empty until the mainnet launch fills them in.
export const MAINNET: ClusterConfig = {
  id: 'mainnet',
  label: 'Mainnet',
  chain: 'solana:mainnet',
  explorerCluster: '',
  escrowProgramId: '',
  multisig: '',
  vault: '',
  martMint: '',
};
