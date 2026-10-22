import { expect, type Locator } from '@playwright/test';

/** Text is readable: at least 10px, visible, not clipped sideways, and not fully transparent. */
export async function expectLegible(locator: Locator, label = 'text') {
  const m = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      fontSize: parseFloat(s.fontSize),
      opacity: parseFloat(s.opacity),
      visibility: s.visibility,
      w: r.width,
      h: r.height,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  });
  const why = `${label} ${JSON.stringify(m)}`;
  expect(m.fontSize, `${why}: font too small`).toBeGreaterThanOrEqual(10);
  expect(m.opacity, `${why}: transparent`).toBeGreaterThan(0.5);
  expect(m.visibility, why).toBe('visible');
  expect(m.w > 0 && m.h > 0, `${why}: collapsed`).toBe(true);
  expect(m.scrollWidth, `${why}: clipped`).toBeLessThanOrEqual(m.clientWidth + 1);
}
