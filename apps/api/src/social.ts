import type { Context } from 'hono';
import type { z } from 'zod';
import {
  identityOf,
  parseSocialConfig,
  voteWeight,
  type PublicIdentity,
  type SocialConfig,
  type Tier,
  type WeightReason,
} from '@trenchmart/shared';
import { HttpError, loadConfig, tierForWallet, type Deps } from './logic';
import { reweighUpvotesOf } from './ranking';
import { xVerified } from './x-oauth';

/** Shared plumbing for the social routes (reviews, votes, ranking, featuring). */

export type Row = Record<string, any>;
export type SocialVars = { Variables: { user: Row | null } };
export type Ctx = Context<SocialVars>;

export async function parseBody<T>(schema: z.ZodType<T>, c: Ctx): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid body');
  return parsed.data;
}

export function signedIn(c: Ctx): Row {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'sign in required');
  if (user.banned_at) throw new HttpError(403, 'BANNED', 'this wallet is banned');
  return user;
}

export function adminOnly(c: Ctx): Row {
  const user = signedIn(c);
  const roles = (user.roles as string[]) ?? [];
  if (!roles.includes('admin')) throw new HttpError(403, 'FORBIDDEN', 'admin role required');
  return user;
}

export async function loadSocialConfig(deps: Deps): Promise<SocialConfig> {
  const rows = await deps.sql<{ value: unknown }[]>`
    select value from config where key = 'social_rules'
  `;
  return parseSocialConfig(rows[0]?.value);
}

/** Public identity of a users row (works with aliased columns via the prefix). */
export function identityRow(row: Row, prefix = ''): PublicIdentity {
  const get = (key: string) => row[`${prefix}${key}`];
  const avatar = get('avatar_media_id') as string | null;
  return identityOf({
    wallet: get('wallet') as string,
    handle: (get('handle') as string | null) ?? null,
    displayName: (get('display_name') as string | null) ?? null,
    xVerified: xVerified({ x_user_id: get('x_user_id') }),
    xHandle: (get('x_handle') as string | null) ?? null,
    avatarUrl: avatar ? `/api/v1/profile-media/${avatar}` : null,
  });
}

/** Columns identityRow needs, aliased with a prefix, for a users table alias. */
export function identityColumns(alias: string, prefix: string): string {
  return ['wallet', 'handle', 'display_name', 'x_user_id', 'x_handle', 'avatar_media_id']
    .map((col) => `${alias}.${col} as ${prefix}${col}`)
    .join(', ');
}

type Funder = { wallet: string; at: string };

/** Marks a wallet for the wallet-intel cron step (oldest activity, recent funders). */
export async function requestIntel(deps: Deps, wallet: string): Promise<void> {
  await deps.sql`
    insert into wallet_intel (wallet, requested_at) values (${wallet}, ${deps.now()})
    on conflict (wallet) do update set requested_at = excluded.requested_at
  `;
}

/** Re-reads the $TRENCH tier (72 h window) and stores it for vote weights. */
export async function refreshHolderTier(deps: Deps, wallet: string): Promise<Tier> {
  let tier: Tier;
  try {
    tier = (await tierForWallet(deps, wallet, await loadConfig(deps))).tier;
  } catch {
    const rows = await deps.sql<{ holder_tier: Tier }[]>`
      select holder_tier from wallet_intel where wallet = ${wallet}
    `;
    return rows[0]?.holder_tier ?? 'none';
  }
  await deps.sql`
    insert into wallet_intel (wallet, holder_tier, tier_checked_at, requested_at)
    values (${wallet}, ${tier}, ${deps.now()}, ${deps.now()})
    on conflict (wallet) do update set holder_tier = excluded.holder_tier, tier_checked_at = excluded.tier_checked_at
  `;
  return tier;
}

/** Everything voteWeight needs about `user`, relative to the creator of what is voted on. */
export async function voterWeight(
  deps: Deps,
  user: Row,
  creatorId: string | null,
  config: SocialConfig,
  options: { refreshTier?: boolean } = {},
): Promise<{ bps: number; reason: WeightReason }> {
  const wallet = user.wallet as string;
  if (options.refreshTier) await refreshHolderTier(deps, wallet);
  const [intel] = await deps.sql<Row[]>`
    select oldest_seen_at, funders, holder_tier from wallet_intel where wallet = ${wallet}
  `;
  const [buyer] = await deps.sql<{ yes: boolean }[]>`
    select exists (
      select 1 from orders o join listings l on l.id = o.listing_id
      where o.buyer_id = ${user.id} and o.status = 'released' and l.creator_id <> ${user.id}
    ) as yes
  `;
  let creatorWallet: string | null = null;
  if (creatorId) {
    const rows = await deps.sql<
      { wallet: string }[]
    >`select wallet from users where id = ${creatorId}`;
    creatorWallet = rows[0]?.wallet ?? null;
  }
  return voteWeight(
    {
      banned: Boolean(user.banned_at),
      accountCreatedAt: new Date(user.created_at as string | Date),
      oldestSeenAt: intel?.oldest_seen_at ? new Date(intel.oldest_seen_at as string) : null,
      isBuyer: Boolean(buyer?.yes),
      holderTier: (intel?.holder_tier as Tier | undefined) ?? 'none',
      fundedByCreator: creatorWallet
        ? fundedBy(intel?.funders as Funder[] | undefined, creatorWallet, deps.now(), config)
        : false,
      isCreator: creatorId === user.id,
    },
    config,
    deps.now(),
  );
}

export function fundedBy(
  funders: Funder[] | undefined,
  wallet: string,
  now: Date,
  config: SocialConfig,
): boolean {
  const since = now.getTime() - config.funderWindowDays * 86_400_000;
  return (funders ?? []).some((f) => f.wallet === wallet && new Date(f.at).getTime() >= since);
}

/**
 * Cron: scans a few requested wallets on chain (oldest activity, SOL senders in the funder
 * window), refreshes their tier, then recomputes the weight of every vote they cast.
 */
export async function scanWalletIntel(deps: Deps, limit = 4): Promise<number> {
  if (!deps.walletHistory) return 0;
  const config = await loadSocialConfig(deps);
  const now = deps.now();
  const rows = await deps.sql<{ wallet: string }[]>`
    select wallet from wallet_intel
    where (scanned_at is null or scanned_at < ${now}::timestamptz - interval '1 day')
      and requested_at > ${now}::timestamptz - interval '60 days'
    order by scanned_at asc nulls first, requested_at desc
    limit ${limit}
  `;
  let done = 0;
  for (const { wallet } of rows) {
    try {
      const history = await deps.walletHistory(
        wallet,
        now.getTime() - config.funderWindowDays * 86_400_000,
      );
      await deps.sql`
        update wallet_intel set
          oldest_seen_at = ${history.oldestAt},
          funders = ${deps.sql.json(history.funders as never)},
          scanned_at = ${now}
        where wallet = ${wallet}
      `;
      await refreshHolderTier(deps, wallet);
      await reweighVotesOf(deps, wallet, config);
      done += 1;
    } catch (err) {
      console.error('wallet-intel', wallet.slice(0, 4), (err as Error).message);
      await deps.sql`update wallet_intel set scanned_at = ${now} where wallet = ${wallet}`;
    }
  }
  return done;
}

/** Recomputes the stored weight of every helpful vote and upvote cast by this wallet. */
export async function reweighVotesOf(deps: Deps, wallet: string, config: SocialConfig) {
  const users = await deps.sql<Row[]>`select * from users where wallet = ${wallet}`;
  const user = users[0];
  if (!user) return;
  const votes = await deps.sql<Row[]>`
    select v.review_id, l.creator_id from review_votes v
    join listing_reviews r on r.id = v.review_id join listings l on l.id = r.listing_id
    where v.user_id = ${user.id}
  `;
  for (const vote of votes) {
    const weight = await voterWeight(deps, user, vote.creator_id as string, config);
    await deps.sql`
      update review_votes set weight_bps = ${weight.bps}
      where review_id = ${vote.review_id} and user_id = ${user.id}
    `;
    await tallyReviewVotes(deps, vote.review_id as string);
  }
  await reweighUpvotesOf(deps, user);
}

export async function tallyReviewVotes(deps: Deps, reviewId: string): Promise<void> {
  await deps.sql`
    update listing_reviews r set
      helpful_count = t.helpful, unhelpful_count = t.unhelpful, helpful_weight = t.weight
    from (
      select
        count(*) filter (where helpful)::int as helpful,
        count(*) filter (where not helpful)::int as unhelpful,
        coalesce(sum(weight_bps) filter (where helpful), 0)::int
          - coalesce(sum(weight_bps) filter (where not helpful), 0)::int as weight
      from review_votes where review_id = ${reviewId}
    ) t
    where r.id = ${reviewId}
  `;
}
