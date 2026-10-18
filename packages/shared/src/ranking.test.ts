import { describe, expect, it } from 'vitest';
import { bayesianRating, parseRankConfig, rankBadge, rankRows, RANK_DEFAULTS } from './ranking';

describe('ranking', () => {
  it('pulls thin ratings toward the site mean', () => {
    expect(bayesianRating(0, null, 20, 4.42)).toBe(4.42);
    expect(bayesianRating(1, 5, 20, 4.42)).toBeCloseTo((5 + 20 * 4.42) / 21, 6);
    expect(bayesianRating(200, 4.9, 20, 4.42)).toBeGreaterThan(4.85);
    expect(bayesianRating(3, 4, 20, null)).toBe(4);
    expect(bayesianRating(0, null, 20, null)).toBeNull();
  });

  it('normalises each part against the category leader and ranks per category and overall', () => {
    const ranked = rankRows(
      [
        { id: 'a', group: 'userscript', sales: 10, bayes: 4.5, upvotes: 4 },
        { id: 'b', group: 'userscript', sales: 5, bayes: 4.8, upvotes: 8 },
        { id: 'c', group: 'filter', sales: 1, bayes: 4.0, upvotes: 0 },
        { id: 'd', group: 'filter', sales: 0, bayes: 4.42, upvotes: 0 },
        { id: 'e', group: 'filter', sales: 50, bayes: 5, upvotes: 50, paused: true },
      ],
      RANK_DEFAULTS,
    );
    const by = Object.fromEntries(ranked.map((r) => [r.id, r]));
    expect(by.a!.salesPart).toBe(1);
    expect(by.b!.upvotesPart).toBe(1);
    expect(by.a!.score).toBeCloseTo(0.5 + 0.3 * (4.5 / 4.8) + 0.2 * 0.5, 3);
    expect(by.b!.score).toBeCloseTo(0.25 + 0.3 + 0.2, 3);
    expect(by.a!.rankGroup).toBe(1);
    expect(by.b!.rankGroup).toBe(2);
    // The paused wash-trading listing neither ranks nor sets the category leader.
    expect(by.e!.rankGroup).toBeNull();
    expect(by.c!.salesPart).toBe(1);
    expect(by.c!.rankGroup).toBe(1);
    // No counted activity: unranked, never a made-up position.
    expect(by.d!.rankGroup).toBeNull();
    expect(by.d!.rankOverall).toBeNull();
    expect([by.a!.rankOverall, by.c!.rankOverall, by.b!.rankOverall]).toEqual([1, 2, 3]);
  });

  it('reads config with bounds and defaults', () => {
    expect(parseRankConfig({ weightSalesBps: '6000', bayesM: -5, junk: 1 })).toMatchObject({
      weightSalesBps: 6000,
      bayesM: 0,
      upvotesPerDay: 30,
    });
    expect(parseRankConfig(null)).toEqual(RANK_DEFAULTS);
  });

  it('shows a badge only for the top of a category', () => {
    expect(rankBadge(3, 'Userscripts')).toBe('#3 in Userscripts');
    expect(rankBadge(11, 'Userscripts')).toBeNull();
    expect(rankBadge(null, 'Userscripts')).toBeNull();
  });
});
