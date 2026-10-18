import { describe, expect, it } from 'vitest';
import {
  cleanReviewText,
  identityOf,
  parseSocialConfig,
  ratingSummary,
  replyTextProblem,
  reviewMessage,
  reviewTextProblem,
  SOCIAL_DEFAULTS,
  voteWeight,
  weightLabel,
  type VoterFacts,
} from './social';

const now = new Date('2026-10-18T00:00:00Z');
const old = new Date('2026-09-01T00:00:00Z');
const base: VoterFacts = {
  banned: false,
  accountCreatedAt: old,
  oldestSeenAt: null,
  isBuyer: false,
  holderTier: 'none',
  fundedByCreator: false,
  isCreator: false,
};

describe('parseSocialConfig', () => {
  it('keeps defaults for missing or invalid fields and clamps the rest', () => {
    expect(parseSocialConfig(undefined)).toEqual(SOCIAL_DEFAULTS);
    const c = parseSocialConfig({
      weightBuyerBps: '20000',
      weightHolderBps: 2500,
      holderMinTier: 'none',
      reviewMinChars: 10,
      reviewMaxChars: 5,
      minWalletAgeDays: 'x',
    });
    expect(c.weightBuyerBps).toBe(10_000);
    expect(c.weightHolderBps).toBe(2500);
    expect(c.holderMinTier).toBe('scout');
    expect(c.reviewMaxChars).toBe(10);
    expect(c.minWalletAgeDays).toBe(7);
    expect(parseSocialConfig({ holderMinTier: 'og' }).holderMinTier).toBe('og');
  });
});

describe('voteWeight', () => {
  const w = (f: Partial<VoterFacts>) => voteWeight({ ...base, ...f }, SOCIAL_DEFAULTS, now);
  it('counts buyers fully and Scout+ holders half', () => {
    expect(w({ isBuyer: true })).toEqual({ bps: 10_000, reason: 'buyer' });
    expect(w({ holderTier: 'trencher' })).toEqual({ bps: 5000, reason: 'holder' });
    expect(w({ isBuyer: true, holderTier: 'og' }).bps).toBe(10_000);
    expect(w({})).toEqual({ bps: 0, reason: 'no_purchase_or_holding' });
  });
  it('never counts banned, own, creator-funded or new wallets', () => {
    expect(w({ banned: true, isBuyer: true }).reason).toBe('banned');
    expect(w({ isCreator: true, isBuyer: true }).reason).toBe('own_listing');
    expect(w({ fundedByCreator: true, isBuyer: true }).reason).toBe('funded_by_creator');
    const fresh = new Date('2026-10-15T00:00:00Z');
    expect(w({ accountCreatedAt: fresh, isBuyer: true }).reason).toBe('wallet_too_new');
    // An old on-chain wallet that just signed up counts at once.
    expect(w({ accountCreatedAt: fresh, oldestSeenAt: old, isBuyer: true }).bps).toBe(10_000);
  });
  it('labels weights', () => {
    expect(weightLabel(10_000)).toBe('1.0×');
    expect(weightLabel(5000)).toBe('0.5×');
    expect(weightLabel(2500)).toBe('0.25×');
    expect(weightLabel(0)).toBe('0×');
  });
});

describe('review text', () => {
  const ok = 'Caught two bundled launches on day one that my usual checks missed.';
  it('accepts plain text within length', () => {
    expect(reviewTextProblem(ok, SOCIAL_DEFAULTS)).toBeNull();
    expect(reviewTextProblem('Too short', SOCIAL_DEFAULTS)).toMatch(/at least 40/);
    expect(reviewTextProblem('a'.repeat(1001), SOCIAL_DEFAULTS)).toMatch(/under 1000/);
  });
  it('rejects links, handles, e-mails, invites and wallet addresses', () => {
    for (const bad of [
      `${ok} see https://evil.example`,
      `${ok} visit rugradar.xyz now`,
      `${ok} DM @rugradar_support`,
      `${ok} mail me a@b.io`,
      `${ok} t.me/scam`,
      `${ok} send to H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ`,
    ])
      expect(reviewTextProblem(bad, SOCIAL_DEFAULTS)).not.toBeNull();
    expect(replyTextProblem('Fixed in v1.4.2, thanks.')).toBeNull();
    expect(replyTextProblem('  ')).toBe('Write a reply.');
    expect(replyTextProblem('join discord.gg/x')).toBe('No links.');
  });
  it('cleans control characters and blank runs', () => {
    expect(cleanReviewText('a\u202e b\n\n\n\nc  ')).toBe('a b\n\nc');
  });
  it('builds the signed message', () => {
    expect(reviewMessage({ orderId: 'o1', rating: 4, semver: '1.4.2', bodySha256: 'ab' })).toBe(
      'TrenchMart review\nOrder: o1\nRating: 4\nVersion: 1.4.2\nText SHA-256: ab\nSigning is free and sends no transaction.',
    );
  });
});

describe('ratingSummary and identity', () => {
  it('summarises visible ratings', () => {
    expect(ratingSummary([5, 5, 4, 1, 9])).toEqual({
      count: 4,
      avg: 3.75,
      histogram: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 },
    });
    expect(ratingSummary([]).avg).toBeNull();
  });
  it('shows names only for X-verified users or chosen pseudonyms', () => {
    const wallet = 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ';
    expect(identityOf({ wallet, xVerified: true, xHandle: 'rug', avatarUrl: '/a' })).toMatchObject({
      kind: 'x',
      name: 'rug',
      avatarUrl: '/a',
    });
    expect(identityOf({ wallet, xVerified: false, displayName: 'night' }).kind).toBe('pseudonym');
    expect(identityOf({ wallet, xVerified: false, handle: 'h', avatarUrl: '/a' })).toMatchObject({
      kind: 'wallet',
      name: 'H4kH…cdbZ',
      avatarUrl: null,
    });
  });
});
