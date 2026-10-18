import { clampInt } from './social';

/**
 * Ranking (listings and creators). Pure scoring so the API job, the web "how it's computed"
 * panels and the tests agree. Every number is a default; the `rank_config` config row wins.
 *
 *   score = wSales·(sales / leaderSales) + wRating·(bayes / leaderBayes) + wUpvotes·(up / leaderUp)
 *
 * where sales are counted 30-day sales (no refunds, self-buys, new or creator-funded wallets),
 * bayes is the Bayesian rating (n·avg + m·C) / (n + m) with C the site-wide mean, and up the
 * weighted upvotes. Each part is normalised against the category leader.
 */

export type RankConfig = {
  weightSalesBps: number;
  weightRatingBps: number;
  weightUpvotesBps: number;
  /** Bayesian prior strength: reviews a listing needs before its own average dominates. */
  bayesM: number;
  windowDays: number;
  upvotesPerDay: number;
  recomputeMinutes: number;
  topRatedMinReviews: number;
  risingMinSales: number;
  /** Creator-funded buyer wallets in the window that pause a listing from ranking. */
  washPauseSales: number;
};

export const RANK_DEFAULTS: RankConfig = {
  weightSalesBps: 5000,
  weightRatingBps: 3000,
  weightUpvotesBps: 2000,
  bayesM: 20,
  windowDays: 30,
  upvotesPerDay: 30,
  recomputeMinutes: 10,
  topRatedMinReviews: 5,
  risingMinSales: 5,
  washPauseSales: 3,
};

export function parseRankConfig(raw: unknown): RankConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = RANK_DEFAULTS;
  return {
    weightSalesBps: clampInt(r.weightSalesBps, d.weightSalesBps, 0, 10_000),
    weightRatingBps: clampInt(r.weightRatingBps, d.weightRatingBps, 0, 10_000),
    weightUpvotesBps: clampInt(r.weightUpvotesBps, d.weightUpvotesBps, 0, 10_000),
    bayesM: clampInt(r.bayesM, d.bayesM, 0, 1000),
    windowDays: clampInt(r.windowDays, d.windowDays, 1, 365),
    upvotesPerDay: clampInt(r.upvotesPerDay, d.upvotesPerDay, 1, 1000),
    recomputeMinutes: clampInt(r.recomputeMinutes, d.recomputeMinutes, 1, 1440),
    topRatedMinReviews: clampInt(r.topRatedMinReviews, d.topRatedMinReviews, 1, 1000),
    risingMinSales: clampInt(r.risingMinSales, d.risingMinSales, 1, 1000),
    washPauseSales: clampInt(r.washPauseSales, d.washPauseSales, 1, 1000),
  };
}

/** Bayesian average: few reviews pull toward the site mean `prior`. Null without a prior. */
export function bayesianRating(
  count: number,
  avg: number | null,
  m: number,
  prior: number | null,
): number | null {
  if (prior === null) return count && avg !== null ? avg : null;
  if (!count || avg === null) return prior;
  return (count * avg + m * prior) / (count + m);
}

export type RankInput = {
  id: string;
  group: string;
  sales: number;
  bayes: number | null;
  /** Weighted upvotes (1 = one fully counted vote). */
  upvotes: number;
  paused?: boolean;
};

export type RankParts = {
  sales: number;
  bayes: number | null;
  upvotes: number;
  salesPart: number;
  ratingPart: number;
  upvotesPart: number;
  score: number;
  leader: { sales: number; bayes: number | null; upvotes: number };
};

export type RankResult = RankParts & {
  id: string;
  group: string;
  rankGroup: number | null;
  rankOverall: number | null;
  paused: boolean;
};

const ratio = (value: number, max: number) => (max > 0 ? value / max : 0);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Scores and ranks rows within their group (category) and overall. Only rows with real
 * activity (a counted sale or counted upvote) and not paused get a rank; the rest stay null.
 */
export function rankRows(rows: RankInput[], config: RankConfig): RankResult[] {
  const leaders = new Map<string, { sales: number; bayes: number; upvotes: number }>();
  for (const row of rows) {
    if (row.paused) continue;
    const lead = leaders.get(row.group) ?? { sales: 0, bayes: 0, upvotes: 0 };
    lead.sales = Math.max(lead.sales, row.sales);
    lead.bayes = Math.max(lead.bayes, row.bayes ?? 0);
    lead.upvotes = Math.max(lead.upvotes, row.upvotes);
    leaders.set(row.group, lead);
  }
  const scored = rows.map((row) => {
    const lead = leaders.get(row.group) ?? { sales: 0, bayes: 0, upvotes: 0 };
    const salesPart = ratio(row.sales, lead.sales);
    const ratingPart = ratio(row.bayes ?? 0, lead.bayes);
    const upvotesPart = ratio(row.upvotes, lead.upvotes);
    const score =
      (config.weightSalesBps * salesPart +
        config.weightRatingBps * ratingPart +
        config.weightUpvotesBps * upvotesPart) /
      10_000;
    return {
      id: row.id,
      group: row.group,
      sales: row.sales,
      bayes: row.bayes === null ? null : round4(row.bayes),
      upvotes: round4(row.upvotes),
      salesPart: round4(salesPart),
      ratingPart: round4(ratingPart),
      upvotesPart: round4(upvotesPart),
      score: round4(score),
      leader: {
        sales: lead.sales,
        bayes: lead.bayes ? round4(lead.bayes) : null,
        upvotes: round4(lead.upvotes),
      },
      paused: Boolean(row.paused),
      rankGroup: null as number | null,
      rankOverall: null as number | null,
    };
  });
  const eligible = scored.filter((r) => !r.paused && (r.sales > 0 || r.upvotes > 0));
  const order = (a: RankResult, b: RankResult) =>
    b.score - a.score || b.sales - a.sales || b.upvotes - a.upvotes || a.id.localeCompare(b.id);
  eligible.sort(order).forEach((r, i) => (r.rankOverall = i + 1));
  const byGroup = new Map<string, RankResult[]>();
  for (const r of eligible) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  for (const list of byGroup.values()) list.sort(order).forEach((r, i) => (r.rankGroup = i + 1));
  return scored;
}

/** "#3 in Userscripts" only for the top of a category; null otherwise. */
export function rankBadge(rank: number | null | undefined, groupLabel: string, top = 10) {
  return rank && rank <= top ? `#${rank} in ${groupLabel}` : null;
}
