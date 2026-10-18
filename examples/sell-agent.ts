/**
 * Example seller agent (Solana devnet): everything a creator does in the studio, through the
 * API with a local keypair. Each step is opt-in so the script is safe on a real account.
 *
 *   TM_KEYPAIR=./creator.json TM_CREATE_LISTING=1 TM_PUBLISH=1 pnpm --filter @trenchmart/examples sell
 *
 * Env:
 *   TM_KEYPAIR             keypair file (required)
 *   TM_DISPLAY_NAME/TM_BIO/TM_WEBSITE   update the profile and socials
 *   TM_CREATE_LISTING=1    create a userscript listing (needs a verified X link and the bond)
 *   TM_X_DEV_HANDLE        local stacks without X OAuth: link this handle unverified
 *   TM_PAY_BOND=1          stake the missing category bond (unsigned tx, signed locally)
 *   TM_LISTING_ID          work on an existing listing you own instead
 *   TM_PUBLISH=1           publish a new version of fixtures/hello.user.js (or TM_FILE)
 *   TM_SEMVER              version to publish (default: next patch)
 *   TM_ACCEPT_SUPPLEMENT=1 pay the daily-limit supplement when the free uploads are used up
 *   TM_PRICE_LAMPORTS      set the listing price
 *   TM_REPLY               reply text for reviews awaiting a reply (TM_REPLY_TO=<reviewId> limits it to one)
 *   TM_KEEP_KEY=1          keep the minted key (by default it is revoked on exit)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { TrenchmartError, type VersionResult } from '@trenchmart/sdk';
import { env, finish, log, setup } from './common';

const flag = (name: string) => process.env[name] === '1';

async function main() {
  const { client, signer } = await setup('example seller agent', [
    'read',
    'sell',
    'profile',
    'review',
  ]);

  // 1. Profile and socials.
  if (process.env.TM_DISPLAY_NAME || process.env.TM_BIO || process.env.TM_WEBSITE) {
    await client.updateProfile({
      displayName: process.env.TM_DISPLAY_NAME,
      bio: process.env.TM_BIO,
      socials: process.env.TM_WEBSITE ? { website: process.env.TM_WEBSITE } : undefined,
    });
  }
  const profile = await client.profile();
  log('profile', {
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    socials: profile.socials,
  });

  // 2. What selling needs: verified X link, category bond, verification fee.
  const req = await client.requirements();
  log('requirements', req);

  // 3. A listing: create one, or use an existing one.
  let listingId = process.env.TM_LISTING_ID;
  if (!req.xLinked && process.env.TM_X_DEV_HANDLE) {
    // Local stacks only: the live site requires X verified through OAuth in the studio.
    await client.linkXDev(process.env.TM_X_DEV_HANDLE);
    req.xLinked = true;
  }
  if (!listingId && flag('TM_CREATE_LISTING'))
    listingId = await createListing(Boolean(req.xLinked));
  if (!listingId) {
    const mine = await client.myListings();
    log('my listings', {
      listings: mine.map((l) => ({ id: l.id, slug: l.slug, price: l.price, live: l.semver })),
    });
  }

  // 4. Publish a version: supplement and verification fee are unsigned txs signed here; the
  //    hybrid scan (static rules + AI review) runs and the verdict comes back with reasons.
  if (listingId && flag('TM_PUBLISH')) {
    const quota = await client.uploadQuota(listingId);
    log(
      'upload quota',
      pick(quota, [
        'uploadsToday',
        'updatesToday',
        'limits',
        'supplementRequired',
        'supplementLamports',
        'reasons',
        'verificationFee',
        'feeWaived',
        'suggestedSemver',
      ]),
    );
    const path =
      process.env.TM_FILE ?? new URL('./fixtures/hello.user.js', import.meta.url).pathname;
    const semver =
      process.env.TM_SEMVER ??
      (quota.suggestedSemver as string | undefined) ??
      nextPatch(quota.currentSemver as string | undefined);
    let source = readFileSync(path, 'utf8');
    if (path.endsWith('.user.js')) source = source.replace(/(@version\s+)\S+/, `$1${semver}`);
    const result = await client.publishVersion(
      signer,
      listingId,
      {
        semver,
        changelog: 'Published by the seller agent',
        fileName: basename(path),
        bytes: new TextEncoder().encode(source),
      },
      { acceptSupplement: flag('TM_ACCEPT_SUPPLEMENT') },
    );
    logVerdict(result);
  }

  // 5. Prices.
  if (listingId && process.env.TM_PRICE_LAMPORTS) {
    await client.updateListing(listingId, { priceLamports: process.env.TM_PRICE_LAMPORTS });
    log('price set', { listingId, priceLamports: process.env.TM_PRICE_LAMPORTS });
  }

  // 6. Business: sales, revenue, subscribers, payouts.
  const overview = await client.overview();
  const sales = await client.sales({ limit: 20 });
  const subscribers = await client.subscribers();
  const payouts = await client.payouts();
  log('business', {
    overview: pick(overview, ['totals', 'sales7d', 'revenue', 'subscribers', 'rating']),
    recentSales: sales.sales.map((s) => ({
      slug: s.slug,
      status: s.status,
      price: s.price,
      paidAt: s.paid_at,
    })),
    subscribers: subscribers.counts,
    payoutsTotal: (payouts.total as { sol?: string } | undefined)?.sol ?? payouts.total,
  });

  // 7. Reviews awaiting a reply.
  const open = await client.creatorReviews({ unreplied: true });
  log('reviews awaiting reply', {
    reviews: open.reviews.map((r) => ({ id: r.id, slug: r.slug, rating: r.rating, body: r.body })),
  });
  const reply = process.env.TM_REPLY;
  if (reply) {
    for (const review of open.reviews) {
      if (process.env.TM_REPLY_TO && review.id !== process.env.TM_REPLY_TO) continue;
      await client.replyToReview(review.id, reply);
      log('replied', { reviewId: review.id });
    }
  }

  async function createListing(xLinked: boolean): Promise<string | undefined> {
    if (!xLinked) {
      log('skip listing', {
        reason: 'X_REQUIRED',
        note: 'verify X once in the studio (Profile > Link X) with this wallet',
      });
      return undefined;
    }
    const input = {
      title: env('TM_TITLE', 'Agent Hello Badge'),
      summary: 'A tiny badge userscript published end to end by an agent.',
      description:
        'Shows the page title in a corner badge on Axiom. Example listing created by the TrenchMart seller agent on devnet.',
      category: 'userscript' as const,
      terminals: ['Axiom'],
      priceLamports: env('TM_PRICE_LAMPORTS', '10000000'),
      license: 'single' as const,
      kind: 'script' as const,
      specs: {
        managers: ['Tampermonkey', 'Violentmonkey'],
        browsers: ['Chrome', 'Firefox'],
        readsPage: true,
        network: 'none',
        hosts: [],
        tradeButtons: false,
        storage: 'none',
      },
    };
    try {
      return (await client.createListing(input)).id;
    } catch (err) {
      if (!(err instanceof TrenchmartError) || err.code !== 'BOND_REQUIRED' || !flag('TM_PAY_BOND'))
        throw err;
      // Each category has its own bond (bondByCategory); stake the difference (1 to 5 SOL per stake).
      const now = await client.requirements();
      const needed = BigInt(
        String((now.bondByCategory as Record<string, string>)[input.category] ?? '0'),
      );
      const missing = needed - BigInt(String(now.bondActive ?? '0'));
      const bond = await client.payBond(
        signer,
        missing > 1_000_000_000n ? missing : 1_000_000_000n,
      );
      log('bond staked', bond);
      return (await client.createListing(input)).id;
    }
  }
}

function logVerdict(result: VersionResult) {
  log('scan verdict', {
    versionId: result.version.id,
    semver: result.version.semver,
    status: result.version.status,
    sha256: result.version.sha256,
    failed: result.checks
      .filter((c) => c.result === 'fail')
      .map((c) => `${c.rule_id}: ${c.detail}`),
    warnings: result.checks
      .filter((c) => c.result === 'warn')
      .map((c) => `${c.rule_id}: ${c.detail}`),
    ai: result.review ? { decision: result.review.decision, notes: result.review.notes } : null,
  });
}

function nextPatch(current?: string): string {
  const m = current?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0';
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

main()
  .then(() => finish())
  .catch(async (err: unknown) => {
    if (err instanceof TrenchmartError)
      log('error', { status: err.status, code: err.code, message: err.message, data: err.data });
    else log('error', { message: (err as Error).message });
    await finish();
    process.exit(1);
  });
