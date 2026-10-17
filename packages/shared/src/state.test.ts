import { describe, expect, it } from 'vitest';
import {
  assertOrderTransition,
  bondMemo,
  canTransitionOrder,
  canTransitionVersion,
  orderMemo,
  verificationFeeMemo,
} from './state';

describe('order transitions', () => {
  it('allows the escrow machine, including a rejected dispute returning to paid', () => {
    expect(canTransitionOrder('pending', 'paid')).toBe(true);
    expect(canTransitionOrder('pending', 'expired')).toBe(true);
    expect(canTransitionOrder('paid', 'released')).toBe(true);
    expect(canTransitionOrder('paid', 'disputed')).toBe(true);
    expect(canTransitionOrder('disputed', 'refunded')).toBe(true);
    expect(canTransitionOrder('disputed', 'paid')).toBe(true);
    expect(canTransitionOrder('disputed', 'released')).toBe(true);
    expect(canTransitionOrder('released', 'disputed')).toBe(true);
    expect(canTransitionOrder('refunded', 'paid')).toBe(false);
    expect(canTransitionOrder('expired', 'paid')).toBe(false);
    expect(() => assertOrderTransition('pending', 'released')).toThrow(/illegal order transition/);
    expect(() => assertOrderTransition('pending', 'paid')).not.toThrow();
  });
});

describe('version transitions', () => {
  it('walks upload to live and blocks a rejected version', () => {
    expect(canTransitionVersion('uploading', 'scanning')).toBe(true);
    expect(canTransitionVersion('scanning', 'needs_creator')).toBe(true);
    expect(canTransitionVersion('scanning', 'rejected')).toBe(true);
    expect(canTransitionVersion('needs_creator', 'in_review')).toBe(true);
    expect(canTransitionVersion('in_review', 'live')).toBe(true);
    expect(canTransitionVersion('live', 'superseded')).toBe(true);
    expect(canTransitionVersion('live', 'delisted')).toBe(true);
    expect(canTransitionVersion('rejected', 'live')).toBe(false);
  });
});

describe('memos', () => {
  it('prefixes the first 8 hex chars of a uuid', () => {
    const id = '12345678-aaaa-bbbb-cccc-ddddeeeeffff';
    expect(orderMemo(id)).toBe('tm:12345678');
    expect(bondMemo(id)).toBe('bond:12345678');
    expect(verificationFeeMemo(id)).toBe('vfee:12345678');
  });
});
