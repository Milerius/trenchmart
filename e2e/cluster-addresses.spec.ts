import { expect, test } from '@playwright/test';
import { DEVNET } from '../apps/web/src/lib/cluster-devnet';
import { e2eAddresses } from './cluster-addresses';

test('e2e addresses default to the devnet cluster config and can be overridden', () => {
  expect(e2eAddresses({})).toEqual({
    martMint: DEVNET.martMint,
    program: DEVNET.escrowProgramId,
    multisig: DEVNET.multisig,
    explorerCluster: DEVNET.explorerCluster,
  });
  expect(e2eAddresses({ E2E_EXPLORER_CLUSTER: '' }).explorerCluster).toBe('');
  const other = e2eAddresses({ E2E_MART_MINT: ' Mint111 ', E2E_ESCROW_PROGRAM_ID: 'Prog111' });
  expect(other.martMint).toBe('Mint111');
  expect(other.program).toBe('Prog111');
  expect(other.multisig).toBe(DEVNET.multisig);
});
