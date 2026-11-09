// The playground is for trying things by hand, but a playground that silently broke would be
// worse than none — so it gets a smoke test: it builds, and every image on it loads in a browser.
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLAYGROUND, build, startServer } from './helpers';

describe('playground', () => {
  let browser: Browser;
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    build({ root: PLAYGROUND });
    server = await startServer('start', 3206, PLAYGROUND);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    server?.stop();
    await browser?.close();
  });

  it('builds, and every image on the page loads', async () => {
    const page = await browser.newPage();
    const failed: string[] = [];
    page.on('response', r => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(server.base);
    await page.getByRole('button', { name: /1800px/ }).click();
    await page.locator('img[width="1800"]').waitFor();

    const images = await page.evaluate(async () => {
      const imgs = [...document.images];
      await Promise.all(imgs.map(i => i.decode().catch(() => {})));
      return imgs.map(i => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 }));
    });
    expect(images).toHaveLength(12);
    expect(images.filter(i => !i.ok)).toEqual([]);
    expect(images.every(i => i.src.includes('/_next/static/media/'))).toBe(true);
    expect(failed).toEqual([]);

    // one size per format, all non-zero
    const sizes = await page.locator('ul.sizes li').allTextContents();
    expect(sizes.map(s => s.split(':')[0])).toEqual(['avif', 'webp', 'jpg']);
    for (const s of sizes) expect(s).not.toMatch(/: 0\.0 kB/);
  });
});
