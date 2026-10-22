import { expect, test, type Page } from '@playwright/test';

// $MART holder rewards page + /status and treasury cards over stubbed /api/v1/rewards/* (the
// endpoints are covered by apps/api/src/rewards.test.ts).

const SIG =
  '4mp7gjFz9H26WAvMAEbbP8Ln1EEvsyWvDhc8xJzzbua3o7tvJ4pHEjeur7YzW1yEqm6XupMb5X4UG5d4qcLrQU9h';
const NOW = Date.now();
const EPOCH = Math.floor(NOW / 10_800_000);
const iso = (ms: number) => new Date(ms).toISOString();

const CURRENT = {
  epoch: EPOCH,
  startsAt: iso(EPOCH * 10_800_000),
  endsAt: iso((EPOCH + 1) * 10_800_000),
  epochSeconds: 10_800,
  samples: { done: 3, planned: 6 },
  revenueSoFar: '4290000000',
  holderGrossSoFar: '2145000000',
  carryIn: '0',
  rules: {
    topN: 1000,
    minSupplyBps: 5,
    minPayoutLamports: '10000000',
    holdEpochs: 2,
    samplesPerEpoch: 6,
    holderShareBps: 5000,
  },
  mint: 'Mart1111111111111111111111111111111111111111',
  vault: 'Vau1t11111111111111111111111111111111111111',
  sending: true,
};
const epoch = (n: number) => ({
  epoch: EPOCH - n,
  startsAt: iso((EPOCH - n) * 10_800_000),
  endsAt: iso((EPOCH - n + 1) * 10_800_000),
  status: 'paid',
  revenue: { lamports: '6120000000', sol: '6.12' },
  costs: { rpc: '0', infra: '0', network_fee: '155000', priority_fee: '3700', payout_fee: '5000' },
  costTotal: '163700',
  holderPool: { lamports: '3059918150', sol: '3.05991815' },
  eligible: 1000,
  paidCount: 612,
  carriedCount: 388,
  paidLamports: '3050000000',
  buybackForward: '1224000000',
  samples: { done: 6, planned: 6 },
  seed: 'ab'.repeat(32),
  fundSig: SIG,
  batches: [{ n: 0, recipients: 20, lamports: '100000000', sig: SIG, status: 'sent' }],
  paidAt: iso(NOW - n * 10_800_000),
});
const FEED = { epochs: [epoch(1), epoch(2), epoch(3)] };
const TOP = {
  epoch: EPOCH - 1,
  holders: [
    {
      wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      rank: 1,
      weightBps: 192,
      lamports: '57900000',
      status: 'pay',
    },
    {
      wallet: '7K8W3EkropbopBvfohodcoro1nkpDz8ViRLCat8ZLE6a',
      rank: 2,
      weightBps: 140,
      lamports: '42300000',
      status: 'pay',
    },
  ],
};

async function stub(page: Page, feed: unknown = FEED) {
  await page.route('**/api/v1/rewards/epochs/recent**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }),
  );
  await page.route('**/api/v1/rewards/current', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(CURRENT) }),
  );
  await page.route('**/api/v1/rewards/top**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(TOP) }),
  );
}

test('/rewards: countdown, pool so far, distributions with Solscan links, top holders', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/rewards');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('top 1,000 holders');
  await expect(page.getByTestId('rewards-countdown')).toHaveText(/^\d\d:\d\d:\d\d$/);
  await expect(page.getByTestId('rewards-pool')).toContainText('◎ 2.145');
  await expect(page.getByText('3 of 6 done')).toBeVisible();
  await expect(page.getByTestId('reward-epoch')).toHaveCount(3);
  await expect(page.getByTestId('reward-fund-tx').first()).toHaveAttribute(
    'href',
    `https://solscan.io/tx/${SIG}?cluster=devnet`,
  );
  await expect(page.getByTestId('reward-epoch').first()).toContainText('612 / 388');
  await expect(page.getByTestId('rewards-top').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('rewards-mine')).toContainText('Connect a wallet');
  await expect(page.getByText('0.01 SOL carry over')).toBeVisible();
});

test('/rewards mobile: no horizontal overflow', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await stub(page);
  await page.goto('/rewards');
  await expect(page.getByTestId('reward-epoch')).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.close();
});

for (const path of ['/status', '/docs/treasury'] as const) {
  test(`${path}: holder rewards card lists epochs, empty state never invents rows`, async ({
    page,
  }) => {
    await stub(page);
    await page.goto(path);
    const card = page.getByTestId('rewards-card');
    await expect(card.getByTestId('reward-epoch')).toHaveCount(3);
    await page.unroute('**/api/v1/rewards/epochs/recent**');
    await page.route('**/api/v1/rewards/epochs/recent**', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ epochs: [] }) }),
    );
    await page.reload();
    await expect(page.getByTestId('rewards-card').getByTestId('rewards-empty')).toBeVisible();
  });
}
