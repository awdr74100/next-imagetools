import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import path from 'node:path';

import type { Browser } from 'playwright';
import sharp from 'sharp';
import { beforeEach, expect } from 'vitest';

// The fixture app consumes the package through its built `dist`, the way users will.
const ROOT = path.resolve(import.meta.dirname, 'fixtures/next-app');
const DIST = path.resolve(import.meta.dirname, '../../dist');
export const PLAYGROUND = path.resolve(import.meta.dirname, '../../playground');
const nextBin = (root: string) => path.join(root, 'node_modules/next/dist/bin/next');
export const HERO = path.join(ROOT, 'images/hero.jpg');
// Copies of the source under names that need URL encoding (a space, parentheses, non-ASCII), so
// every mode also checks that the generated URLs survive in src and srcset.
const HERO_COPIES = ['my photo (1).jpg', 'café.jpg'].map(name => path.join(ROOT, 'images', name));
/** Imported by a single import of the fixture, so the dev suite can delete it and put it back. */
export const ACCENTED = HERO_COPIES[1]!;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

const ALL_BUNDLERS = ['turbopack', 'webpack'] as const;
export type Bundler = (typeof ALL_BUNDLERS)[number];

/**
 * Every suite runs once per bundler: Turbopack, Next.js' default, and webpack (`--webpack`).
 * `NIT_BUNDLER` narrows that to one, so CI can run the bundlers as parallel jobs.
 */
export const BUNDLERS: readonly Bundler[] = (() => {
  const only = process.env.NIT_BUNDLER;
  if (!only) return ALL_BUNDLERS;
  if (!(ALL_BUNDLERS as readonly string[]).includes(only)) {
    throw new Error(`NIT_BUNDLER must be one of ${ALL_BUNDLERS.join(', ')}, got "${only}"`);
  }
  return [only as Bundler];
})();
const bundlerFlags = (bundler: Bundler) => (bundler === 'webpack' ? ['--webpack'] : []);

// Fail loudly rather than test a stale or missing build.
if (!existsSync(path.join(DIST, 'loader.cjs'))) {
  throw new Error('dist is missing; run `pnpm build` first.');
}

export type RGB = { r: number; g: number; b: number };
export const BLUE: RGB = { r: 30, g: 120, b: 200 };
export const RED: RGB = { r: 200, g: 40, b: 40 };

/** Writes the fixture source image; the background color lets tests tell versions apart. */
export async function writeHero(background: RGB) {
  const svg =
    '<svg width="1600" height="1000"><circle cx="800" cy="500" r="300" fill="orange"/></svg>';
  const buf = await sharp({ create: { width: 1600, height: 1000, channels: 3, background } })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg()
    .toBuffer();
  for (const file of [HERO, ...HERO_COPIES]) writeFileSync(file, buf);
}

/** Imagetools' disk cache in the fixture, at its default location. */
export const IMAGETOOLS_CACHE = path.join(ROOT, 'node_modules/.cache/next-imagetools');

export function clean({ next = false, imagetools = false }) {
  if (next) {
    rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    rmSync(path.join(ROOT, 'out'), { recursive: true, force: true });
  }
  if (imagetools) rmSync(IMAGETOOLS_CACHE, { recursive: true, force: true });
}

export function build({
  bundler = 'turbopack',
  exportMode = false,
  root = ROOT,
  extraEnv = {},
}: {
  bundler?: Bundler;
  exportMode?: boolean;
  root?: string;
  extraEnv?: Record<string, string>;
} = {}) {
  const res = spawnSync(process.execPath, [nextBin(root), 'build', ...bundlerFlags(bundler)], {
    cwd: root,
    env: { ...env, NIT_EXPORT: exportMode ? '1' : '', ...extraEnv },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`next build failed:\n${res.stdout}\n${res.stderr}`);
  // the bundlers print their warnings on either stream
  return `${res.stdout}\n${res.stderr}`;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** A plain static file server over `out/`, standing in for any CDN: no Next.js at runtime. */
export async function serveExport(port: number) {
  const dir = path.join(ROOT, 'out');
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    const candidates = [pathname, `${pathname}.html`, path.posix.join(pathname, 'index.html')];
    for (const c of candidates) {
      const file = path.join(dir, c);
      if (file.startsWith(dir) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(r => server.listen(port, r));
  return { base: `http://localhost:${port}`, stop: () => server.close() };
}

function kill(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, 'localhost');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Stops a server and waits until its port is free. Returning earlier lets the next server on the
 * same port race a dying one: the readiness check can be answered by the old process, serving the
 * old content, which reads exactly like a stale cache.
 */
async function stopServer(child: ChildProcess, port: number) {
  if (child.exitCode === null && child.pid) {
    const exited = new Promise(r => child.once('exit', r));
    kill(child);
    await Promise.race([exited, sleep(15_000)]);
  }
  // next spawns worker processes; the port is only free once all of them are gone
  const deadline = Date.now() + 15_000;
  while (await isListening(port)) {
    if (Date.now() > deadline) throw new Error(`port ${port} still in use after stopping next`);
    await sleep(200);
  }
}

/**
 * Prints the server's output when a test fails. Cache bugs tend to be intermittent, and a failure
 * that only says "wrong pixel" can't be diagnosed after the fact; the server log (compile errors,
 * warnings, what it rebuilt) usually can.
 */
export function logServerOnFailure(getServer: () => { log: () => string } | undefined) {
  beforeEach(({ onTestFailed }) => {
    onTestFailed(({ task }) => {
      const log = getServer()?.log();
      if (log)
        console.error(
          `\n--- next log for "${task.name}" ---\n${log.slice(-20_000)}\n--- end ---\n`,
        );
    });
  });
}

export function startServer(
  mode: 'start' | 'dev',
  port: number,
  root = ROOT,
  // `next start` loads next.config again, so it needs the env the build was configured with
  // `next start` serves whatever was built; only `next dev` takes the bundler
  {
    bundler = 'turbopack',
    readyPath = '/',
    extraEnv = {},
  }: { bundler?: Bundler; readyPath?: string; extraEnv?: Record<string, string> } = {},
) {
  const flags = mode === 'dev' ? bundlerFlags(bundler) : [];
  return startProcess([nextBin(root), mode, ...flags, '-p', String(port)], {
    cwd: root,
    port,
    name: `next ${mode}`,
    readyPath,
    extraEnv,
  });
}

/**
 * Starts the server of an `output: 'standalone'` build the way Next.js documents deploying it:
 * `.next/static` — where the generated images live — copied next to `server.js`.
 */
export function startStandalone(port: number) {
  // in a workspace, the server sits at the app's path relative to the workspace root
  const workspaceRoot = path.resolve(ROOT, '../../../..');
  const serverDir = path.join(ROOT, '.next', 'standalone', path.relative(workspaceRoot, ROOT));
  cpSync(path.join(ROOT, '.next', 'static'), path.join(serverDir, '.next', 'static'), {
    recursive: true,
  });
  return startProcess([path.join(serverDir, 'server.js')], {
    cwd: serverDir,
    port,
    name: 'standalone server',
    extraEnv: { PORT: String(port), HOSTNAME: 'localhost' },
  });
}

async function startProcess(
  args: string[],
  options: {
    cwd: string;
    port: number;
    name: string;
    readyPath?: string;
    extraEnv?: Record<string, string>;
  },
) {
  const { cwd, port, name, readyPath = '/', extraEnv = {} } = options;
  if (await isListening(port)) {
    throw new Error(`port ${port} is already in use: a previous server did not shut down`);
  }
  const child = spawn(process.execPath, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'pipe' });
  let log = '';
  child.stdout!.on('data', d => (log += d));
  child.stderr!.on('data', d => (log += d));
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${name} exited:\n${log}`);
    try {
      const res = await fetch(base + readyPath);
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline) {
      kill(child);
      throw new Error(`${name} did not become ready:\n${log}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { base, log: () => log, stop: () => stopServer(child, port) };
}

type Expected = {
  label: string;
  url: string;
  width: number;
  height?: number;
  format: 'webp' | 'avif' | 'jpeg';
  /**
   * How far each channel of the corner pixel may be from the source's background. An 8px
   * placeholder averages a large area into each pixel, so it gets more room — still far less than
   * the distance between the blue and the red source the suites switch between.
   */
  tolerance?: number;
};

const parseSrcset = (s: string) =>
  s.split(', ').map(part => {
    const [url, w] = part.split(' ');
    if (!url || !w) throw new Error(`malformed srcset entry: ${JSON.stringify(part)}`);
    return { url, width: Number.parseInt(w) };
  });

const fromSrcset = (label: string, srcset: string, format: Expected['format']): Expected[] =>
  parseSrcset(srcset).map(({ url, width }) => ({
    label: `${label} ${width}w`,
    url,
    width,
    format,
  }));

/** The values of the fixture's imports, as the page serializes them. */
export function readImports(html: string) {
  const json = html.match(/<script id="imports" type="application\/json">(.*?)<\/script>/)?.[1];
  expect(json, 'imports JSON on the page').toBeTruthy();
  return JSON.parse(json!);
}

export const CONFIG_FILE = path.join(ROOT, 'imagetools.config.mjs');

/** Extracts every image URL the page exposes, with what it should decode to. */
function expectedImages(html: string): Expected[] {
  const data = readImports(html);
  const hidden = html.match(/id="hidden-src" data-src="([^"]+)"/)?.[1];
  expect(hidden, 'client-only image src').toBeTruthy();

  const out: Expected[] = [
    { label: 'url', url: data.heroUrl, width: 400, format: 'webp' },
    { label: 'gallery 300w', url: data.heroGallery[0], width: 300, format: 'webp' },
    { label: 'gallery 600w', url: data.heroGallery[1], width: 600, format: 'webp' },
    { label: 'clamped 1/2', url: data.heroClamped[0], width: 1600, format: 'webp' },
    { label: 'clamped 2/2', url: data.heroClamped[1], width: 1600, format: 'webp' },
    { label: 'preset=thumb', url: data.heroThumb, width: 120, format: 'webp' },
    { label: 'as=next', url: data.heroNext.src, width: 600, format: 'webp' },
    {
      label: 'as=next blurDataURL',
      url: data.heroNext.blurDataURL,
      width: 8,
      height: 5,
      format: 'webp',
      tolerance: 60,
    },
    {
      label: 'placeholder variant',
      url: data.heroPlaceholder.src,
      width: 320,
      height: 320,
      format: 'webp',
    },
    {
      label: 'placeholder',
      url: data.heroPlaceholder.placeholder,
      width: 8,
      height: 8,
      format: 'webp',
      tolerance: 60,
    },
    { label: 'accented file name', url: data.accented, width: 40, format: 'webp' },
    ...fromSrcset('spaced file name srcset', data.spacedSrcset, 'webp'),
    // fetch() decodes data: URLs too, so an inlined image goes through the same checks
    { label: 'inline', url: data.heroInline, width: 24, format: 'webp' },
    ...fromSrcset('srcset', data.heroSrcset, 'webp'),
    ...fromSrcset('picture avif', data.heroPicture.sources.avif, 'avif'),
    ...fromSrcset('picture webp', data.heroPicture.sources.webp, 'webp'),
    { label: 'picture img', url: data.heroPicture.img.src, width: 800, format: 'jpeg' },
    { label: 'metadata', url: data.heroMeta.src, width: 500, format: 'webp' },
    {
      label: 'client-only',
      url: hidden!.replace(/&amp;/g, '&'),
      width: 250,
      height: 250,
      format: 'webp',
    },
    { label: 'plain import', url: data.plain.src, width: 1600, format: 'jpeg' },
  ];
  expect(parseSrcset(data.heroSrcset).map(s => s.width)).toEqual([300, 600, 900]);
  expect(data.heroGallery, '&imagetools-gallery yields an array').toHaveLength(2);
  expect(data.heroClamped, 'values clamped to one size keep the array shape').toHaveLength(2);
  expect(data.heroClamped[0], 'identical variants share one file').toBe(data.heroClamped[1]);
  expect(data.excluded, 'an excluded import keeps Next.js handling').toMatchObject({
    width: 64,
    height: 48,
    src: expect.stringMatching(/\/photo\.[\w~-]+\.jpg$/),
  });
  // spaces and non-ASCII are percent-encoded, so a URL is one srcset token
  // (hashes are [\w-] in current Next.js; 16.2 also used ~)
  expect(data.accented, 'non-ASCII file name').toMatch(/\/caf%C3%A9\.jpg\.[\w~-]+\.webp$/);
  expect(parseSrcset(data.spacedSrcset).map(s => s.width)).toEqual([40, 80]);
  expect(data.spacedSrcset).toMatch(/\/my%20photo%20\(1\)\.jpg\./);
  expect(data.heroInline, 'inline gives a data URL').toMatch(/^data:image\/webp;base64,/);
  // what the marker types in components/typed.ts claim, at runtime
  expect(typeof data.typed.single).toBe('string');
  expect(data.typed.pair).toHaveLength(2);
  expect(data.typed.metas.map((m: { width: number }) => m.width)).toEqual([200, 400]);
  expect(data.typed.meta, 'metadata typed with `as` first').toMatchObject({ format: 'jpeg' });
  expect(data.heroNext, 'as=next is StaticImageData for the largest variant').toMatchObject({
    width: 600,
    height: 375,
    blurWidth: 8,
    blurHeight: 5,
    blurDataURL: expect.stringMatching(/^data:image\/webp;base64,/),
  });
  expect(data.heroPlaceholder.placeholder, 'placeholder on as=img').toMatch(
    /^data:image\/webp;base64,/,
  );
  expect(data.heroDims, 'custom output format from the config file').toEqual([
    { w: 100 },
    { w: 200 },
  ]);
  // a same-format output keeps the source's name; a converted one adds the new extension
  expect(data.heroPicture.img.src, 'jpg from a jpg source').toMatch(/\/hero\.[\w~-]+\.jpg$/);
  expect(data.heroUrl, 'webp from a jpg source').toMatch(/\/hero\.jpg\.[\w~-]+\.webp$/);
  expect(data.named, 'named exports match the default export').toEqual({
    src: data.heroMeta.src,
    width: data.heroMeta.width,
  });
  expect(typeof data.heroUrl, '&imagetools yields a single URL').toBe('string');
  expect(data.heroPicture.img).toMatchObject({ w: 800, h: 500 });
  expect(data.heroMeta).toMatchObject({ width: 500, height: 313, format: 'webp' });
  return out;
}

const CONTENT_TYPE = { webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg' };

/** Fetches every image on the page and checks status, type, size and source version. */
export async function verifyPage(base: string, color: RGB, route = '/') {
  const res = await fetch(base + route);
  expect(res.status, `GET ${route}`).toBe(200);
  return verifyHtml(base, await res.text(), color);
}

/**
 * `toServerUrl` maps an image URL to where the test server has it, for deployments that put assets
 * elsewhere (an `assetPrefix` pointing at a CDN).
 */
export async function verifyHtml(
  base: string,
  html: string,
  color: RGB,
  toServerUrl: (url: string) => string = url => url,
) {
  const images = expectedImages(html);
  for (const img of images) {
    const res = await fetch(new URL(toServerUrl(img.url), base));
    expect(res.status, `${img.label} ${img.url}`).toBe(200);
    expect(res.headers.get('content-type'), `${img.label} content-type`).toContain(
      CONTENT_TYPE[img.format],
    );
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.width, `${img.label} width`).toBe(img.width);
    if (img.height) expect(meta.height, `${img.label} height`).toBe(img.height);
    expect(meta.format === 'heif' ? 'avif' : meta.format, `${img.label} format`).toBe(img.format);
    const { data } = await sharp(buf)
      .extract({ left: 1, top: 1, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const [r = -1, g = -1, b = -1] = data;
    const px = { r, g, b };
    for (const c of ['r', 'g', 'b'] as const) {
      expect(
        Math.abs(px[c] - color[c]),
        `${img.label} pixel ${c} (got ${JSON.stringify(px)})`,
      ).toBeLessThan(img.tolerance ?? 25);
    }
  }
  return images;
}

/**
 * Loads the route in a real browser, reveals the client-only image, and checks that every <img>
 * actually decoded. Returns the rendered HTML so CSR pages (whose server HTML has no images) can go
 * through verifyHtml too.
 */
export async function verifyInBrowser(browser: Browser, base: string, route: string, mode: string) {
  const page = await browser.newPage();
  const failed: string[] = [];
  page.on('response', r => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  // next/image shows the blur placeholder only until the image loads, then removes it, so record
  // the style #next has when it first appears — server-rendered or rendered on the client
  await page.addInitScript(() => {
    const record = window as unknown as { firstNextStyle?: string };
    new MutationObserver(() => {
      const el = document.querySelector('#next');
      if (el && record.firstNextStyle === undefined) {
        record.firstNextStyle = el.getAttribute('style') ?? '';
      }
    }).observe(document, { childList: true, subtree: true });
  });
  try {
    await page.goto(base + route);
    await expect.poll(() => page.locator('#mode').textContent(), { timeout: 30_000 }).toBe(mode);
    const firstStyle = await page.evaluate(
      () => (window as unknown as { firstNextStyle?: string }).firstNextStyle,
    );
    expect(firstStyle, `${route}: next/image starts with the as=next blur placeholder`).toMatch(
      /background-image:\s*url\("?data:image\/svg\+xml/,
    );
    await page.locator('button', { hasText: 'show' }).click();
    await page.locator('#hidden').waitFor();
    const broken = await page.evaluate(async () => {
      const imgs = [...document.images];
      await Promise.all(imgs.map(i => i.decode().catch(() => {})));
      return imgs.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.currentSrc || i.src);
    });
    expect(broken, `${route}: images that did not decode`).toEqual([]);
    // Chromium supports AVIF, so <picture> must pick the first source
    expect(
      await page.locator('#picture img').evaluate((i: HTMLImageElement) => i.currentSrc),
    ).toMatch(/\.avif$/);
    expect(failed, `${route}: failed requests`).toEqual([]);
    return await page.content();
  } finally {
    await page.close();
  }
}

export async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() > deadline) throw lastErr;
    await new Promise(r => setTimeout(r, 1000));
  }
}
