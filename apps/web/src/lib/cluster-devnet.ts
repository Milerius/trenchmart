import type { ClusterConfig } from './cluster-types';

export const DEVNET: ClusterConfig = {
  id: 'devnet',
  label: 'Devnet',
  chain: 'solana:devnet',
  explorerCluster: 'devnet',
  escrowProgramId: 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw',
  multisig: 'CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B',
  vault: '47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7',
  trenchMint: '8Gu4hXYypyRrxY6763AdhQnyHma82L3ww9wq3vy2cbq6',
};
