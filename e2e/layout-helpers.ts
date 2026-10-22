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

/**
 * `expectLegible` fails when a visible control cannot be read in full:
 * - its box is narrower than `minWidth` (a search box squashed to an icon pill, a button
 *   shrunk around one letter);
 * - it or any descendant clips its text (scrollWidth > clientWidth), or an input's placeholder
 *   is wider than the input's content box (canvas measureText with the input's font);
 * - its text paints outside its own box, or onto any of the `others` boxes (the search "/"
 *   hint spilling onto "Sell");
 * - for text inputs, the input itself is narrower than `minInputWidth` (default 160 px).
 */
export async function expectLegible(
  locator: Locator,
  label: string,
  opts: { minWidth?: number; minInputWidth?: number; others?: Locator[] } = {},
) {
  const others: { x: number; y: number; w: number; h: number }[] = [];
  for (const other of opts.others ?? []) {
    if (!(await other.isVisible())) continue;
    const b = await other.boundingBox();
    if (b) others.push({ x: b.x, y: b.y, w: b.width, h: b.height });
  }
  const m = await locator.evaluate(
    (el, { others, minInputWidth }) => {
      const box = el.getBoundingClientRect();
      const clipped: string[] = [];
      const inputs: number[] = [];
      for (const node of [el, ...Array.from(el.querySelectorAll('*'))] as HTMLElement[]) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (node.matches('.sr-only') || node.closest('.sr-only')) continue;
        if (node instanceof HTMLInputElement && node.type !== 'hidden') {
          inputs.push(node.getBoundingClientRect().width);
          // Placeholder text is not a text node: measure it with the input's own font.
          if (node.placeholder && !node.value) {
            const ctx = document.createElement('canvas').getContext('2d')!;
            ctx.font = style.font;
            const text = ctx.measureText(node.placeholder).width;
            const room =
              node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            if (text > room + 1)
              clipped.push(
                `placeholder "${node.placeholder}" ${text.toFixed(0)}>${room.toFixed(0)}`,
              );
          }
          continue;
        }
        if (
          node.textContent?.trim() &&
          node.scrollWidth > node.clientWidth + 1 &&
          node.clientWidth > 0
        )
          clipped.push(
            `${node.tagName}:${node.textContent.trim().slice(0, 20)} ${node.scrollWidth}>${node.clientWidth}`,
          );
      }
      const spills: string[] = [];
      const hits: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.textContent?.trim() || !parent || parent.closest('.sr-only')) continue;
        if (getComputedStyle(parent).visibility === 'hidden') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 0.5 || r.height < 0.5) continue;
          if (r.left < box.left - 1 || r.right > box.right + 1)
            spills.push(
              `"${node.textContent.trim()}" ${r.left.toFixed(0)}-${r.right.toFixed(0)} outside ${box.left.toFixed(0)}-${box.right.toFixed(0)}`,
            );
          for (const o of others) {
            const ox = Math.min(r.right, o.x + o.w) - Math.max(r.left, o.x);
            const oy = Math.min(r.bottom, o.y + o.h) - Math.max(r.top, o.y);
            if (ox > 0.5 && oy > 0.5)
              hits.push(`"${node.textContent.trim()}" over ${JSON.stringify(o)}`);
          }
        }
      }
      const narrowInputs = inputs.filter((w) => w < minInputWidth);
      return { width: box.width, clipped, spills, hits, narrowInputs };
    },
    { others, minInputWidth: opts.minInputWidth ?? 160 },
  );
  const why = `${label} ${JSON.stringify(m)}`;
  expect(m.width, `${why}: narrower than ${opts.minWidth ?? 0}px`).toBeGreaterThanOrEqual(
    opts.minWidth ?? 0,
  );
  expect(m.clipped, `${why}: text clipped`).toEqual([]);
  expect(m.spills, `${why}: text paints outside its box`).toEqual([]);
  expect(m.hits, `${why}: text overlaps a sibling`).toEqual([]);
  expect(m.narrowInputs, `${why}: input narrower than ${opts.minInputWidth ?? 160}px`).toEqual([]);
}
