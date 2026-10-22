import type { ClusterConfig } from './cluster-types';

export const DEVNET: ClusterConfig = {
  id: 'devnet',
  label: 'Devnet',
  chain: 'solana:devnet',
  explorerCluster: 'devnet',
  escrowProgramId: 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw',
  multisig: 'CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B',
  vault: '47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7',
  // Devnet test SPL mint standing in for $MART (1B supply, 6 decimals).
  martMint: 'FLEdRySnQLYioT9FecE44LexuVfKMaC2uRjK9GgTrZ92',
  rewardsVault: 'Ef77nnj2s5QdFcMKzsMsbfdU62acc8FigtZFHGptgKzu',
  rewardsSpendingLimit: 'BfmFsUnqbjfa6tDujW8t8s7cBQyfH94yo8cmxWCALm19',
  rewardsWallet: 'E2ms9dtUPYUi7eSTgVqK2HZpXCveZZdUk91GPhUNQq4T',
};
