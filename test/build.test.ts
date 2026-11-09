import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BLUE, RED, build, clean, startServer, verifyPage, writeHero } from './helpers';

const PORT = 3201;

async function buildAndVerify(color: typeof BLUE) {
  build();
  const server = await startServer('start', PORT);
  try {
    return await verifyPage(server.base, color);
  } finally {
    server.stop();
  }
}

// Each step builds on the cache state the previous one left behind.
describe.sequential('next build (Turbopack)', () => {
  beforeAll(() => writeHero(BLUE));
  afterAll(() => writeHero(BLUE));

  let coldUrls: string[];

  it('cold: no .next, no imagetools cache', async () => {
    clean({ next: true, imagetools: true });
    coldUrls = (await buildAndVerify(BLUE)).map(i => i.url);
  });

  it('warm: both caches present, same URLs', async () => {
    const urls = (await buildAndVerify(BLUE)).map(i => i.url);
    expect(urls).toEqual(coldUrls);
  });

  it('only .next removed', async () => {
    clean({ next: true });
    await buildAndVerify(BLUE);
  });

  it('only imagetools cache removed', async () => {
    clean({ imagetools: true });
    await buildAndVerify(BLUE);
  });

  it('source edited, all caches kept: new content and new URLs', async () => {
    await writeHero(RED);
    const urls = (await buildAndVerify(RED)).map(i => i.url);
    const generated = urls.slice(0, -1); // the last one is the plain import
    for (const u of generated) expect(coldUrls).not.toContain(u);
  });

  it('source reverted, all caches kept: old version comes back', async () => {
    await writeHero(BLUE);
    await buildAndVerify(BLUE);
  });
});
