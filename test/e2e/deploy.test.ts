// Deployment shapes beyond the default: a sub-path, assets on another prefix, and the standalone
// server output. Generated images are Turbopack assets, or files emitted where Next.js puts its own
// static images under webpack, so they should follow Next.js' own static files in each — these
// tests hold that in place.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  BLUE,
  BUNDLERS,
  build,
  clean,
  logServerOnFailure,
  readImports,
  startServer,
  startStandalone,
  verifyHtml,
  verifyPage,
  writeHero,
} from './helpers';

const PORT = 3207;

/** The generated (not inlined) image URLs a page references. */
const generatedUrls = (html: string): string[] => {
  const data = readImports(html);
  return [
    data.heroUrl,
    ...data.heroGallery,
    data.heroPicture.img.src,
    data.heroMeta.src,
    data.accented,
  ] as string[];
};

describe.for(BUNDLERS)('deployment shapes (%s)', { concurrent: false }, bundler => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  logServerOnFailure(() => server);
  beforeAll(() => writeHero(BLUE));
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('basePath: pages and images live under the sub-path', async () => {
    clean({ next: true });
    const extraEnv = { NIT_BASE_PATH: '/docs' };
    build({ bundler, extraEnv });
    server = await startServer('start', PORT, undefined, { readyPath: '/docs', extraEnv });
    await verifyPage(server.base, BLUE, '/docs');
    const html = await (await fetch(`${server.base}/docs`)).text();
    for (const url of generatedUrls(html)) expect(url).toMatch(/^\/docs\/_next\/static\/media\//);
  });

  it('assetPrefix: image URLs carry the prefix, like Next.js’ own assets', async () => {
    clean({ next: true });
    const extraEnv = { NIT_ASSET_PREFIX: '/cdn' };
    build({ bundler, extraEnv });
    server = await startServer('start', PORT, undefined, { extraEnv });
    const html = await (await fetch(`${server.base}/`)).text();
    for (const url of generatedUrls(html)) expect(url).toMatch(/^\/cdn\/_next\/static\/media\//);
    // the same prefix Next.js put on its own scripts
    expect(html).toMatch(/<script src="\/cdn\/_next\/static\/chunks\//);
    // a CDN would serve the prefix; here, strip it to fetch from the server behind it
    await verifyHtml(server.base, html, BLUE, url => url.replace(/^\/cdn/, ''));
  });

  it('output: standalone serves every image from the documented .next/static copy', async () => {
    clean({ next: true });
    build({ bundler, extraEnv: { NIT_STANDALONE: '1' } });
    server = await startStandalone(PORT);
    await verifyPage(server.base, BLUE);
  });
});
