import { existsSync, readdirSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BLUE,
  BUNDLERS,
  IMAGETOOLS_CACHE,
  RED,
  build,
  clean,
  startServer,
  verifyPage,
  writeHero,
  type Bundler,
} from './helpers';

const PORT = 3201;

async function buildAndVerify(
  bundler: Bundler,
  color: typeof BLUE,
  extraEnv: Record<string, string> = {},
) {
  const log = build({ bundler, extraEnv });
  // An early prototype made Turbopack log "AVIF image not supported" for generated AVIF files
  // (they were emitted fine). The cause wasn't pinned down before it went away, so guard against
  // it coming back.
  expect(log).not.toMatch(/AVIF image not supported/);
  const server = await startServer('start', PORT);
  try {
    return await verifyPage(server.base, color);
  } catch (error) {
    console.error(`
--- next start log ---
${server.log().slice(-20_000)}
--- end ---
`);
    throw error;
  } finally {
    await server.stop();
  }
}

// Each step builds on the cache state the previous one left behind.
describe.for(BUNDLERS)('next build (%s)', { concurrent: false }, bundler => {
  beforeAll(() => writeHero(BLUE));
  afterAll(() => writeHero(BLUE));

  let coldUrls: string[];

  it('cold: no .next, no imagetools cache', async () => {
    clean({ next: true, imagetools: true });
    coldUrls = (await buildAndVerify(bundler, BLUE)).map(i => i.url);
  });

  it('warm: both caches present, same URLs', async () => {
    const urls = (await buildAndVerify(bundler, BLUE)).map(i => i.url);
    expect(urls).toEqual(coldUrls);
  });

  it('only .next removed', async () => {
    clean({ next: true });
    await buildAndVerify(bundler, BLUE);
  });

  it('only imagetools cache removed', async () => {
    clean({ imagetools: true });
    await buildAndVerify(bundler, BLUE);
  });

  it('source edited, all caches kept: new content and new URLs', async () => {
    await writeHero(RED);
    const urls = (await buildAndVerify(bundler, RED)).map(i => i.url);
    const generated = urls.slice(0, -1); // the last one is the plain import
    for (const u of generated) expect(coldUrls).not.toContain(u);
  });

  it('source reverted, all caches kept: old version comes back', async () => {
    await writeHero(BLUE);
    await buildAndVerify(bundler, BLUE);
  });

  // The module loader and the asset loader each encode an image when nothing is cached, possibly
  // in different workers. Encoding must be deterministic, or the URL a page renders could name a
  // file that was never emitted (what vite-imagetools 9.0.2 did when it re-encoded cache hits).
  it('disk cache off: every image encoded again, same URLs as the cold build', async () => {
    clean({ next: true, imagetools: true });
    const urls = (await buildAndVerify(bundler, BLUE, { NIT_NO_CACHE: '1' })).map(i => i.url);
    expect(urls).toEqual(coldUrls);
    expect(existsSync(IMAGETOOLS_CACHE) ? readdirSync(IMAGETOOLS_CACHE) : []).toEqual([]);
  });
});
