import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

import type { Browser } from 'playwright';
import sharp from 'sharp';
import { expect } from 'vitest';

// The fixture app consumes the package through its built `dist`, the way users will.
const ROOT = path.resolve(import.meta.dirname, '../fixtures/next-app');
const DIST = path.resolve(import.meta.dirname, '../packages/turbopack-imagetools/dist');
const NEXT_BIN = path.join(ROOT, 'node_modules/next/dist/bin/next');
export const HERO = path.join(ROOT, 'images/hero.jpg');
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

// Fail loudly rather than test a stale or missing build.
if (!existsSync(path.join(DIST, 'loader.cjs'))) {
  throw new Error('packages/turbopack-imagetools/dist is missing; run `pnpm build` first.');
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
  writeFileSync(HERO, buf);
}

export function clean({ next = false, imagetools = false }) {
  if (next) {
    rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    rmSync(path.join(ROOT, 'out'), { recursive: true, force: true });
  }
  if (imagetools)
    rmSync(path.join(ROOT, 'node_modules/.cache/turbopack-imagetools'), {
      recursive: true,
      force: true,
    });
}

export function build({ exportMode = false } = {}) {
  const res = spawnSync(process.execPath, [NEXT_BIN, 'build'], {
    cwd: ROOT,
    env: { ...env, TPIT_EXPORT: exportMode ? '1' : '' },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`next build failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
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

export async function startServer(mode: 'start' | 'dev', port: number) {
  const child = spawn(process.execPath, [NEXT_BIN, mode, '-p', String(port)], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  });
  let log = '';
  child.stdout!.on('data', d => (log += d));
  child.stderr!.on('data', d => (log += d));
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next ${mode} exited:\n${log}`);
    try {
      const res = await fetch(base + '/');
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline) {
      kill(child);
      throw new Error(`next ${mode} did not become ready:\n${log}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { base, log: () => log, stop: () => kill(child) };
}

type Expected = {
  label: string;
  url: string;
  width: number;
  height?: number;
  format: 'webp' | 'avif' | 'jpeg';
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

/** Extracts every image URL the page exposes, with what it should decode to. */
function expectedImages(html: string): Expected[] {
  const json = html.match(/<script id="imports" type="application\/json">(.*?)<\/script>/)?.[1];
  expect(json, 'imports JSON on the page').toBeTruthy();
  const data = JSON.parse(json!);
  const hidden = html.match(/id="hidden-src" data-src="([^"]+)"/)?.[1];
  expect(hidden, 'client-only image src').toBeTruthy();

  const out: Expected[] = [
    { label: 'url', url: data.heroUrl, width: 400, format: 'webp' },
    { label: 'gallery 300w', url: data.heroGallery[0], width: 300, format: 'webp' },
    { label: 'gallery 600w', url: data.heroGallery[1], width: 600, format: 'webp' },
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

export async function verifyHtml(base: string, html: string, color: RGB) {
  const images = expectedImages(html);
  for (const img of images) {
    const res = await fetch(new URL(img.url, base));
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
      ).toBeLessThan(25);
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
  try {
    await page.goto(base + route);
    await expect.poll(() => page.locator('#mode').textContent(), { timeout: 30_000 }).toBe(mode);
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
