import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BLUE, RED, clean, startServer, verifyPage, waitFor, writeHero } from './helpers';

const PORT = 3202;

// Each step builds on the cache state the previous one left behind.
describe.sequential('next dev (Turbopack)', () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  beforeAll(async () => {
    await writeHero(BLUE);
    clean({ next: true, imagetools: true });
  });
  afterAll(async () => {
    server?.stop();
    await writeHero(BLUE);
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
    server!.stop();
    server = await startServer('dev', PORT);
    await verifyPage(server.base, RED);
  });

  it('source edited while the server is stopped', async () => {
    server!.stop();
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
});
