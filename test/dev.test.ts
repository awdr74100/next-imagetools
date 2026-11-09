import { readFileSync, writeFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BLUE,
  CONFIG_FILE,
  RED,
  clean,
  logServerOnFailure,
  readImports,
  startServer,
  verifyPage,
  waitFor,
  writeHero,
} from './helpers';

const PORT = 3202;

// Each step builds on the cache state the previous one left behind.
describe.sequential('next dev (Turbopack)', () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  logServerOnFailure(() => server);
  const originalConfig = readFileSync(CONFIG_FILE, 'utf8');

  beforeAll(async () => {
    await writeHero(BLUE);
    clean({ next: true, imagetools: true });
  });
  afterAll(async () => {
    await server?.stop();
    await writeHero(BLUE);
    writeFileSync(CONFIG_FILE, originalConfig);
  });

  it('cold start serves every image', async () => {
    server = await startServer('dev', PORT);
    await verifyPage(server.base, BLUE);
  });

  it('editing the source while running updates the images', async () => {
    await writeHero(RED);
    await waitFor(() => verifyPage(server!.base, RED));
  });

  it('restart reuses the persistent cache without going stale', async () => {
    await server!.stop();
    server = await startServer('dev', PORT);
    await verifyPage(server.base, RED);
  });

  it('source edited while the server is stopped', async () => {
    await server!.stop();
    await writeHero(BLUE);
    server = await startServer('dev', PORT);
    await verifyPage(server.base, BLUE);
  });

  it('imagetools cache removed while running, then source edited', async () => {
    clean({ imagetools: true });
    await writeHero(RED);
    await waitFor(() => verifyPage(server!.base, RED));
    expect(server!.log()).not.toMatch(/EPERM|ENOENT/);
  });

  it('editing the config file while running updates the imports that use it', async () => {
    const edited = originalConfig.replace(
      '({ w: image.info.width })',
      '({ w: image.info.width, h: image.info.height })',
    );
    expect(edited, 'the edit must apply').not.toBe(originalConfig);
    writeFileSync(CONFIG_FILE, edited);
    await waitFor(async () => {
      const data = readImports(await (await fetch(server!.base + '/')).text());
      expect(data.heroDims).toEqual([
        { w: 100, h: 63 },
        { w: 200, h: 125 },
      ]);
    });
  });
});
