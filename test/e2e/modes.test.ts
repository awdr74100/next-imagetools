import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  BLUE,
  build,
  clean,
  logServerOnFailure,
  serveExport,
  startServer,
  verifyHtml,
  verifyInBrowser,
  writeHero,
} from './helpers';

// route → the text ImageGrid renders in #mode
const SERVER_ROUTES: Record<string, string> = {
  '/': 'app-static',
  '/ssr': 'app-ssr',
  '/edge': 'app-edge',
  '/csr': 'app-csr',
  '/legacy-static': 'pages-static',
  '/legacy-ssr': 'pages-ssr',
};
const EXPORT_ROUTES: Record<string, string> = {
  '/': 'app-static',
  '/csr': 'app-csr',
  '/legacy-static': 'pages-static',
};

let browser: Browser;
beforeAll(async () => {
  await writeHero(BLUE);
  browser = await chromium.launch();
});
afterAll(() => browser?.close());

describe('rendering modes, next start', { concurrent: false }, () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  logServerOnFailure(() => server);
  beforeAll(async () => {
    clean({ next: true, imagetools: true });
    build();
    server = await startServer('start', 3203);
  });
  afterAll(() => server?.stop());

  for (const [route, mode] of Object.entries(SERVER_ROUTES)) {
    it(`${route} (${mode})`, async () => {
      const html = await verifyInBrowser(browser, server.base, route, mode);
      await verifyHtml(server.base, html, BLUE);
    });
  }
});

describe('rendering modes, output: export on a plain static server', { concurrent: false }, () => {
  let server: Awaited<ReturnType<typeof serveExport>>;
  beforeAll(async () => {
    clean({ next: true, imagetools: true });
    build({ exportMode: true });
    server = await serveExport(3204);
  });
  afterAll(() => server?.stop());

  for (const [route, mode] of Object.entries(EXPORT_ROUTES)) {
    it(`${route} (${mode})`, async () => {
      const html = await verifyInBrowser(browser, server.base, route, mode);
      await verifyHtml(server.base, html, BLUE);
    });
  }
});

describe('rendering modes, next dev', { concurrent: false }, () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  logServerOnFailure(() => server);
  beforeAll(async () => {
    clean({ next: true, imagetools: true });
    server = await startServer('dev', 3205);
  });
  afterAll(() => server?.stop());

  for (const [route, mode] of Object.entries(SERVER_ROUTES)) {
    it(`${route} (${mode})`, async () => {
      const html = await verifyInBrowser(browser, server.base, route, mode);
      await verifyHtml(server.base, html, BLUE);
    });
  }
});
