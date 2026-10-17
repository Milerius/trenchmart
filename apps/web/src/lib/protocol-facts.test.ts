import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG_JSON,
  MALICIOUS_DISPUTE_MS,
  PAYMENT_GRACE_MS,
  canTransitionOrder,
  disputeBody,
} from '@trenchmart/shared';
import {
  CONTACT_EMAIL,
  DISPUTE_REASONS,
  ESCROW_INSTRUCTIONS,
  ESCROW_PROGRAM_ID,
  PAYOUT_BATCH_LIMIT,
  bonds,
  bpsPercent,
  effectiveFeeBps,
  feeSplit,
  marketplaceFeeLabel,
  orderEdges,
  protocol,
  solLabel,
  tierRows,
} from './protocol-facts';

const root = new URL('../../../../', import.meta.url);

describe('protocol facts', () => {
  it('pins the seeded fee, split, bond, and window numbers', () => {
    expect(DEFAULT_CONFIG_JSON.fee_bps).toBe(500);
    expect(marketplaceFeeLabel).toBe('5%');
    expect(protocol.marketplaceFeeBps).toBe(DEFAULT_CONFIG_JSON.fee_bps);
    expect(protocol.creatorCommission).toBe('0%');
    expect(feeSplit.map((row) => [row.key, row.bps, row.percent])).toEqual([
      ['buyback', 4000, '40%'],
      ['ai_verification', 2500, '25%'],
      ['ops', 2000, '20%'],
      ['safety', 1500, '15%'],
    ]);
    expect(feeSplit.reduce((sum, row) => sum + row.bps, 0)).toBe(10_000);
    expect(protocol.verificationFee).toBe('0.25 SOL');
    expect(protocol.verificationFeeLamports).toBe(250_000_000);
    expect(protocol.verificationFeeFreeFrom).toBe('trencher');
    expect(protocol.ogBondDiscount).toBe('50%');
    expect(protocol.escrowHours).toBe(48);
    expect(protocol.orderTtlMinutes).toBe(20);
    expect(protocol.paymentGraceMinutes).toBe(5);
    expect(PAYMENT_GRACE_MS).toBe(5 * 60 * 1000);
    expect(protocol.maliciousDisputeDays).toBe(30);
    expect(MALICIOUS_DISPUTE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(protocol.bondUnlockDays).toBe(30);
    expect(protocol.tierWindowHours).toBe(72);
    expect(protocol.maxFileDefault).toBe('5 MiB');
    expect(protocol.maxFileSetup).toBe('25 MiB');
    expect(protocol.thresholds).toEqual({ scout: '[X]', trencher: '[Y]', og: '[Z]' });
  });

  it('derives tier buyer fees and category bonds from config', () => {
    expect(tierRows.map((row) => [row.tier, row.rebateBps, row.buyerFee])).toEqual([
      ['none', 0, '5%'],
      ['scout', 2500, '3.75%'],
      ['trencher', 6000, '2%'],
      ['og', 10000, '0%'],
    ]);
    for (const row of tierRows) {
      expect(row.buyerFee).toBe(bpsPercent(effectiveFeeBps(row.tier)));
      expect(row.rebateBps).toBe(DEFAULT_CONFIG_JSON.tier_rebate_bps[row.tier]);
    }
    expect(bonds.map((bond) => [bond.code, bond.sol, bond.ogSol])).toEqual([
      ['userscript', '5 SOL', '2.5 SOL'],
      ['wallet_list', '2 SOL', '1 SOL'],
      ['filter', '1 SOL', '0.5 SOL'],
      ['setup', '5 SOL', '2.5 SOL'],
      ['strategy', '1 SOL', '0.5 SOL'],
      ['alerts', '5 SOL', '2.5 SOL'],
    ]);
    expect(solLabel(5_000_000_000n)).toBe('5 SOL');
  });

  it('follows the order state machine and the dispute reasons', () => {
    expect(orderEdges).toEqual([
      { from: 'pending', to: 'paid' },
      { from: 'pending', to: 'expired' },
      { from: 'paid', to: 'released' },
      { from: 'paid', to: 'disputed' },
      { from: 'released', to: 'disputed' },
      { from: 'disputed', to: 'paid' },
      { from: 'disputed', to: 'released' },
      { from: 'disputed', to: 'refunded' },
    ]);
    for (const edge of orderEdges) expect(canTransitionOrder(edge.from, edge.to)).toBe(true);
    expect([...disputeBody.shape.reason.options]).toEqual([...DISPUTE_REASONS]);
  });

  it('matches the devnet program, the payout batch, and the contact address', () => {
    const program = readFileSync(new URL('programs/trench_escrow/src/lib.rs', root), 'utf8');
    expect(program).toContain(`declare_id!("${ESCROW_PROGRAM_ID}")`);
    expect(program).toContain('seeds = [b"escrow", order_id.as_ref()]');
    for (const name of ESCROW_INSTRUCTIONS) expect(program).toContain(`pub fn ${name}`);
    expect(program).toContain('pub resolver: Signer');
    const logic = readFileSync(new URL('apps/api/src/logic.ts', root), 'utf8');
    expect(logic).toContain(`limit ${PAYOUT_BATCH_LIMIT}`);
    expect(CONTACT_EMAIL).toBe('support@trenchmart.fun');
    expect(protocol.programId).toBe(ESCROW_PROGRAM_ID);
    expect(protocol.cluster).toBe('devnet');
  });
});
