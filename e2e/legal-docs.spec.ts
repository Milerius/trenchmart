import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  CONTACT_LABEL,
  DOCS_NAV,
  ESCROW_PROGRAM_ID,
  bonds,
  feeSplit,
  protocol,
} from '../apps/web/src/lib/protocol-facts';

const pages = ['/terms', '/privacy', ...DOCS_NAV.map((item) => item.href)] as const;

for (const path of pages) {
  test(`${path} renders and has no serious axe violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId('nav')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test('footer and wallet picker link to the terms and privacy pages', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');

  await page.getByTestId('connect').click();
  const modal = page.getByTestId('connect-modal');
  await expect(modal.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
    'href',
    '/terms',
  );
  await modal.getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(page).toHaveURL('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
});

test('terms and privacy name the product, the data, and the contact address', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByText(CONTACT_LABEL).first()).toBeVisible();
  await expect(page.locator(`a[href="${protocol.contactUrl}"]`).first()).toBeVisible();
  await expect(page.getByText(/non-custodial/i).first()).toBeVisible();
  await expect(page.getByText(/malware, drainers/i)).toBeVisible();
  await expect(page.getByText(ESCROW_PROGRAM_ID)).toBeVisible();
  await expect(page.getByText(/not legal advice|counsel/i)).toHaveCount(0);

  await page.goto('/privacy');
  await expect(page.getByText(/wallet address/i).first()).toBeVisible();
  await expect(page.getByText(/X handle/i).first()).toBeVisible();
  await expect(page.getByText(/Supabase/).first()).toBeVisible();
  await expect(page.getByText(/Cloudflare/).first()).toBeVisible();
  await expect(page.getByText(/not legal advice|counsel/i)).toHaveCount(0);
});

test('docs sidebar, diagrams, and config numbers render', async ({ page }) => {
  await page.goto('/docs');
  const nav = page.getByTestId('docs-nav');
  for (const item of DOCS_NAV) {
    await expect(nav.getByRole('link', { name: item.label })).toHaveAttribute('href', item.href);
  }
  await expect(page.getByTestId('diagram-purchase')).toBeVisible();

  await nav.getByRole('link', { name: 'Buyers' }).click();
  await expect(page).toHaveURL('/docs/buyers');
  await expect(page.getByTestId('buyer-escrow-hours')).toHaveText(protocol.escrowWindow);
  await expect(page.getByTestId('diagram-purchase')).toBeVisible();

  await page.goto('/docs/sellers');
  await expect(page.getByTestId('seller-vfee')).toHaveText(protocol.verificationFee);
  await expect(page.getByTestId('diagram-verification')).toBeVisible();
  for (const bond of bonds) {
    await expect(page.getByTestId(`bond-${bond.code}`)).toContainText(bond.sol);
  }

  await page.goto('/docs/escrow');
  await expect(page.getByTestId('escrow-program-id')).toHaveText(ESCROW_PROGRAM_ID);
  await expect(page.getByTestId('diagram-escrow-state')).toBeVisible();
  await expect(page.getByTestId('order-edges')).toContainText('paid → released');

  await page.goto('/docs/fees');
  await expect(page.getByTestId('fee-marketplace')).toHaveText(protocol.marketplaceFeeLabel);
  await expect(page.getByTestId('fee-verification')).toHaveText(protocol.verificationFee);
  await expect(page.getByTestId('fee-og-bond')).toHaveText(protocol.ogBondDiscount);
  for (const row of feeSplit) {
    await expect(page.getByTestId(`fee-split-${row.key}`)).toContainText(row.percent);
  }
  await expect(page.getByTestId('diagram-fees')).toBeVisible();
  await expect(page.getByTestId('tier-og')).toContainText('0%');
  await expect(page.getByTestId('tier-scout')).toContainText('3.75%');
});

test.describe('docs on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const { href } of DOCS_NAV) {
    test(`${href} fits a 390 px screen; the docs nav scrolls inside its own row`, async ({
      page,
    }) => {
      await page.goto(href);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const widths = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.page).toBeLessThanOrEqual(widths.viewport);
      const nav = page.getByTestId('docs-nav');
      const box = await nav.boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(390);
      const list = nav.locator('ul');
      expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    });
  }
});

test('docs overview follows the prototype: serif title, numbered purchase flow first', async ({
  page,
}) => {
  await page.goto('/docs');
  const h1 = page.getByRole('heading', { level: 1, name: 'How TrenchMart works' });
  await expect(h1.locator('em')).toHaveText('works');
  const flow = page.getByTestId('diagram-purchase');
  await expect(flow.getByRole('listitem')).toHaveCount(5);
  await expect(flow.getByRole('listitem').first()).toContainText('Buyer opens a live listing');
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(headings.slice(0, 2)).toEqual(['The purchase flow', 'Where the figures come from']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
