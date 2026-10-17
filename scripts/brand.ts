/**
 * Renders the brand PNGs and the web app icons from the SVG sources in brand/.
 *
 *   pnpm brand
 *
 * Text in the SVGs is already outlined (Geist), so the output does not depend
 * on installed fonts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const BRAND = 'brand';
const APP = 'apps/web/src/app';

async function render(page: Page, svg: string, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
      `<img src="${src}" width="${width}" height="${height}">`,
  );
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

/** ICO container holding PNG images, which every current browser accepts. */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

async function main() {
  const mark = await readFile(`${BRAND}/logo-mark.svg`, 'utf8');
  const avatar = await readFile(`${BRAND}/src/x-avatar-400.svg`, 'utf8');
  const header = await readFile(`${BRAND}/src/x-header-1500x500.svg`, 'utf8');
  // iOS rounds home-screen icons itself, so the apple icon is full-bleed.
  const squareMark = mark.replace('rx="14"', 'rx="0"');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const out: Record<string, Buffer> = {
      [`${BRAND}/x-avatar-400.png`]: await render(page, avatar, 400, 400),
      [`${BRAND}/x-header-1500x500.png`]: await render(page, header, 1500, 500),
      [`${BRAND}/favicon-32.png`]: await render(page, mark, 32, 32),
      [`${APP}/apple-icon.png`]: await render(page, squareMark, 180, 180),
      [`${APP}/favicon.ico`]: ico([
        { size: 16, png: await render(page, mark, 16, 16) },
        { size: 32, png: await render(page, mark, 32, 32) },
        { size: 48, png: await render(page, mark, 48, 48) },
      ]),
      [`${APP}/icon.svg`]: Buffer.from(mark),
    };
    await mkdir(BRAND, { recursive: true });
    for (const [path, data] of Object.entries(out)) {
      await writeFile(path, data);
      console.log(`${path} (${(data.length / 1024).toFixed(1)} KB)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
