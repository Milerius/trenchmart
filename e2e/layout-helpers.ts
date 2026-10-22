import { expect, type Locator } from '@playwright/test';

/**
 * Layout assertions reusable for any pill, button or nav row.
 *
 * `expectSingleLine` fails when text wrapped: the element's text spans more than one line box
 * (measured with a Range over its text, so padding and fixed heights cannot hide a wrap) or
 * the element is taller than one line-height plus its vertical padding/border.
 */
export async function expectSingleLine(locator: Locator, label = 'element') {
  const m = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight =
      style.lineHeight === 'normal' ? fontSize * 1.25 : parseFloat(style.lineHeight);
    const range = document.createRange();
    range.selectNodeContents(el);
    // Line boxes of the visible text nodes only (icons and inline wrappers can sit a few px
    // off the text baseline). Tops closer than half a line-height are the same line.
    const tops: number[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const textRange = document.createRange();
      textRange.selectNodeContents(node);
      for (const rect of Array.from(textRange.getClientRects()))
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          !tops.some((t) => Math.abs(t - rect.top) < lineHeight / 2)
        )
          tops.push(rect.top);
    }
    const textHeight = range.getBoundingClientRect().height;
    const box = el.getBoundingClientRect();
    const chrome =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    return {
      lines: tops.length,
      textHeight,
      lineHeight,
      height: box.height,
      chrome,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  });
  const why = `${label} ${JSON.stringify(m)}`;
  expect(m.lines, `${why}: text wraps`).toBeLessThanOrEqual(1);
  expect(m.textHeight, `${why}: text taller than one line`).toBeLessThan(m.lineHeight * 1.6);
  // Fixed-height pills (h-10) are allowed; anything taller than ~1.6 lines plus chrome wrapped.
  expect(m.height, `${why}: box taller than one line`).toBeLessThan(
    Math.max(m.lineHeight * 1.6 + m.chrome, 48),
  );
  expect(m.scrollWidth, `${why}: content clipped`).toBeLessThanOrEqual(m.clientWidth + 1);
}

/** No horizontal overflow: the container (and the page) does not scroll sideways. */
export async function expectNoHorizontalOverflow(locator: Locator, label = 'container') {
  const m = await locator.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
  }));
  expect(m.scrollWidth, `${label} overflows ${JSON.stringify(m)}`).toBeLessThanOrEqual(
    m.clientWidth,
  );
  expect(m.docScroll, `page overflows ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.docClient);
}

/** Visible items do not overlap each other and stay inside the viewport. */
export async function expectNoOverlap(items: { label: string; locator: Locator }[]) {
  const boxes: { label: string; x: number; y: number; w: number; h: number }[] = [];
  for (const { label, locator } of items) {
    if (!(await locator.isVisible())) continue;
    const b = await locator.boundingBox();
    if (b) boxes.push({ label, x: b.x, y: b.y, w: b.width, h: b.height });
  }
  const vw = await items[0]!.locator.page().evaluate(() => document.documentElement.clientWidth);
  for (const a of boxes) {
    expect(a.x, `${a.label} starts off-screen`).toBeGreaterThanOrEqual(-0.5);
    expect(a.x + a.w, `${a.label} ends off-screen`).toBeLessThanOrEqual(vw + 0.5);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(
        overlapX > 0.5 && overlapY > 0.5,
        `${a.label} overlaps ${b.label}: ${JSON.stringify({ a, b })}`,
      ).toBe(false);
    }
}
