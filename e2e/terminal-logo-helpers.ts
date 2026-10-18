import { expect, type Locator } from '@playwright/test';

const LOGOS: Record<string, string> = {
  Axiom: '/terminals/axiom.svg',
  GMGN: '/terminals/gmgn.png',
  Photon: '/terminals/photon.png',
  Terminal: '/terminals/terminal.svg',
  Trojan: '/terminals/trojan.png',
};

/** The bundled logo for `name` inside `scope` is visible, local, decoded and small (inline). */
export async function expectTerminalLogo(scope: Locator, name: string, maxPx = 20) {
  const img = scope.locator(`img[data-terminal-logo="${name}"]`).first();
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', LOGOS[name]!);
  await expect(img).toHaveAttribute('alt', '');
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  const box = await img.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(10);
  expect(box!.width).toBeLessThanOrEqual(maxPx);
}
