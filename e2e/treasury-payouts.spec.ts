import { expect, test } from '@playwright/test';
import { protocol } from '../apps/web/src/lib/protocol-facts';

test('treasury docs describe the capped automated payouts', async ({ page }) => {
  await page.goto('/docs/treasury');
  const copy = page.getByTestId('payouts-auto');
  await expect(copy).toContainText('Squads spending limit');
  await expect(copy).toContainText(`${protocol.payoutDailyCapSol} SOL a day`);
  await expect(copy).toContainText(`${protocol.payoutMaxLineSol} SOL`);
  await expect(copy).toContainText('never pays twice');
  await expect(page.getByText('remove the spending limit at any time')).toBeVisible();
});
