/**
 * Example buyer agent (Solana devnet). Signs everything locally with a keypair file.
 *
 *   TM_KEYPAIR=./buyer.json pnpm --filter @trenchmart/examples buy
 *
 * Env: TM_KEYPAIR (required), TM_LISTING (slug or id; default: cheapest live listing),
 * TM_MAX_LAMPORTS (price cap), TM_API_KEY (reuse a key instead of minting one),
 * TM_WAIT_RELEASE=1 (wait out the escrow window, release, then review),
 * TM_REVIEW (review text), TM_ORDER (skip buying: release and review this order),
 * TM_UPVOTE=0 (skip the upvote), TM_DISPLAY_NAME / TM_BIO (edit the buyer profile),
 * TM_KEEP_KEY=1 (keep the minted key; by default it is revoked on exit),
 * TM_API_URL / TM_RPC_URL (local stacks).
 */
import { createHash } from 'node:crypto';
import { TrenchmartError } from '@trenchmart/sdk';
import { env, finish, log, setup } from './common';

async function main() {
  const { client, signer } = await setup('example buyer agent', [
    'read',
    'trade',
    'review',
    'profile',
  ]);
  try {
    await run();
  } finally {
    await finish(client);
  }

  async function run() {
    if (process.env.TM_ORDER) {
      // GET /orders/{id} carries listing_id (no slug): resolve the slug for the upvote.
      const order = await client.order(process.env.TM_ORDER);
      const listing = await client.listing(String(order.listing_id));
      await releaseAndReview(process.env.TM_ORDER, listing.terminals[0]);
      await upvoteAndProfile(listing.slug);
      return;
    }

    // 1. Discover: search, then read each candidate and its signed security report.
    const candidates: string[] = [];
    if (process.env.TM_LISTING) candidates.push(process.env.TM_LISTING);
    else {
      const found = await client.listings({ sort: 'price_asc', limit: 12 });
      candidates.push(...(Array.isArray(found) ? found : found.items).map((item) => item.slug));
    }
    for (const slug of candidates) {
      const listing = await client.listing(slug);
      if (listing.creator.wallet === signer.publicKey) continue;
      const report = await client.securityReport(listing.slug).catch(() => null);
      const steps = (
        (report?.report as { steps?: { kind: string; summary: string }[] } | undefined)?.steps ?? []
      ).map((step) => `${step.kind}:${step.summary}`);
      log('listing', {
        slug: listing.slug,
        title: listing.title,
        price: listing.price,
        seller: listing.creator.wallet,
        scan: steps,
      });

      // 2. Buy: the SDK checks the unsigned escrow transaction (programs, signer, total,
      //    seller), signs it locally, relays it through the validated broadcast endpoint and
      //    waits for the API to confirm the funded escrow.
      let bought;
      try {
        bought = await client.buy(signer, listing.slug, {
          maxTotalLamports: process.env.TM_MAX_LAMPORTS
            ? BigInt(process.env.TM_MAX_LAMPORTS)
            : undefined,
        });
      } catch (err) {
        if (
          err instanceof TrenchmartError &&
          ['ALREADY_OWNED', 'OWN_LISTING', 'HOLDER_ONLY', 'HOLDER_WINDOW'].includes(err.code)
        ) {
          log('skip', { slug: listing.slug, reason: err.code });
          continue;
        }
        throw err;
      }
      log('bought', bought);
      await afterPurchase(bought, listing.terminals[0]);
      await upvoteAndProfile(listing.slug);
      return;
    }
    throw new Error('no listing this wallet can buy');
  }

  // 5. Upvote what it bought (weighted, one per listing, capped per day) and fill in the
  //    buyer profile other buyers and creators see next to its reviews.
  async function upvoteAndProfile(slug: string) {
    if (env('TM_UPVOTE', '1') === '1') {
      try {
        const state = await client.upvote(slug);
        log('upvoted', { slug, ...pick(state, ['count', 'counted', 'viewer']) });
      } catch (err) {
        // Daily cap reached: not fatal for the run.
        if (!(err instanceof TrenchmartError) || err.code !== 'UPVOTE_LIMIT') throw err;
        log('upvote skipped', { slug, reason: err.code });
      }
    }
    if (process.env.TM_DISPLAY_NAME || process.env.TM_BIO) {
      await client.updateProfile({
        displayName: process.env.TM_DISPLAY_NAME,
        bio: process.env.TM_BIO,
      });
      const profile = await client.profile();
      log('profile updated', { displayName: profile.displayName, bio: profile.bio });
    }
  }

  async function afterPurchase(
    bought: { orderId: string; escrowUntil: string },
    terminal?: string,
  ) {
    // 3. Download the watermarked file through its short-lived signed URL.
    const file = await client.downloadFile(bought.orderId);
    log('downloaded', {
      semver: file.meta.semver,
      bytes: file.bytes.length,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
    });

    if (env('TM_WAIT_RELEASE', '0') !== '1') {
      log('done', {
        note: `escrow releases after ${bought.escrowUntil}; rerun review then`,
        orderId: bought.orderId,
      });
      return;
    }
    await releaseAndReview(bought.orderId, terminal);
  }

  // 4. After the escrow window: release (permissionless on chain) and review.
  async function releaseAndReview(orderId: string, terminal?: string) {
    const released = await client.waitAndRelease(orderId);
    log('released', released);
    // Release is idempotent (a released order answers with its signature); a second review
    // of the same order is refused, which a rerun treats as done.
    try {
      const review = await client.review(signer, orderId, {
        rating: 5,
        body: env(
          'TM_REVIEW',
          'Bought, downloaded and installed by an autonomous agent; it matched the listing.',
        ),
        terminal,
      });
      log('reviewed', review);
    } catch (err) {
      if (!(err instanceof TrenchmartError) || err.code !== 'ALREADY_REVIEWED') throw err;
      log('review skipped', { orderId, reason: err.code });
    }
  }
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

main().catch((err: unknown) => {
  if (err instanceof TrenchmartError)
    log('error', { status: err.status, code: err.code, message: err.message });
  else log('error', { message: (err as Error).message });
  process.exit(1);
});
