// Calls the built loaders directly with a minimal loader context, without Next.js. Fast checks of
// what the loader emits; the build/dev/mode suites cover what Turbopack does with it.
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BLUE, HERO, writeHero } from './helpers';

const require = createRequire(import.meta.url);
const dist = path.resolve(import.meta.dirname, '../packages/turbopack-imagetools/dist');
type Loader = { default: (this: object) => Promise<string | Buffer>; raw?: boolean };
const moduleLoader = require(path.join(dist, 'loader.cjs')) as Loader;
const assetLoader = require(path.join(dist, 'asset-loader.cjs')) as Loader;

let cacheDir: string;
beforeAll(async () => {
  await writeHero(BLUE);
  cacheDir = mkdtempSync(path.join(tmpdir(), 'tpit-'));
});
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

let warnings: string[] = [];
const context = (resourceQuery: string, resourcePath = HERO, options: object = {}) => ({
  resourcePath,
  resourceQuery,
  rootContext: path.dirname(HERO),
  getOptions: () => ({ cache: { dir: cacheDir }, ...options }),
  emitWarning: (e: Error) => warnings.push(e.message),
});

const runModule = (query: string, options?: object) =>
  moduleLoader.default.call(context(query, HERO, options)) as Promise<string>;

/** The exported value as JSON, with each asset reference replaced by its import index. */
const exported = (code: string): unknown =>
  JSON.parse(
    code
      .match(/const __tpit_value = (.*);\n/)![1]!
      .replaceAll(/" \+ __tpit_url\(__tpit_(\d+)\) \+ "/g, '#$1'),
  );

describe('module loader', () => {
  it('exposes the loader-runner shape (default + raw)', () => {
    expect(typeof moduleLoader.default).toBe('function');
    expect(moduleLoader.raw).toBe(true);
    expect(typeof assetLoader.default).toBe('function');
    expect(assetLoader.raw).toBe(true);
  });

  it('type markers do not change the output or the cache entries', async () => {
    const plain = await runModule('?w=400&format=webp');
    const entries = readdirSync(cacheDir).length;
    expect(await runModule('?w=400&format=webp&imagetools')).toBe(plain);
    expect(await runModule('?w=400&format=webp&imagetools-gallery')).toBe(plain);
    expect(readdirSync(cacheDir)).toHaveLength(entries);
    expect(plain).not.toMatch(/imagetools/);
  });

  it('one asset import per resolved config, carrying the output extension', async () => {
    const code = await runModule('?w=300;600&format=avif;webp');
    const imports = [...code.matchAll(/import __tpit_\d+ from "([^"]+)"/g)].map(m => m[1]);
    expect(imports).toHaveLength(4);
    expect(imports.filter(i => i?.includes('tpit_ext=avif'))).toHaveLength(2);
    expect(imports.filter(i => i?.includes('tpit_ext=webp'))).toHaveLength(2);
  });

  it('as=metadata:<keys> keeps only those keys', async () => {
    const code = await runModule('?w=300&format=webp&as=metadata:width;height');
    const value = code.match(/const __tpit_value = (.*);\n/)?.[1];
    expect(value).toBe('{"width":300,"height":188}');
  });

  it('as=picture lists every format but the last as a source, and uses the last as fallback', async () => {
    const code = await runModule('?w=300&format=avif;webp;jpg&as=picture');
    expect(code).toMatch(/"sources":\{"avif":"[^}]*","webp":"[^}]*"\}/);
    expect(code).not.toMatch(/"sources":\{[^}]*"jpe?g"/);
    expect(code).toMatch(/"img":\{"src":"" \+ __tpit_url\(__tpit_2\)/);
  });

  describe('return shape follows the query, not the source size', () => {
    // the fixture source is 1600px wide, so 3000 clamps to 1600
    it('keeps an array when values clamp to the same size', async () => {
      warnings = [];
      const value = exported(await runModule('?w=1600;3000&format=webp'));
      expect(value).toEqual(['#0', '#1']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/w=1600;3000 goes beyond the source's 1600px/);
    });

    it('keeps metadata an array too', async () => {
      const value = exported(await runModule('?w=1600;3000&format=webp&as=metadata:width'));
      expect(value).toEqual([{ width: 1600 }, { width: 1600 }]);
    });

    it('lists each size once in single-value formats', async () => {
      expect(exported(await runModule('?w=1600;3000&format=webp&as=srcset'))).toBe('#0 1600w');
      const picture = exported(await runModule('?w=800;1600;3000&format=webp;jpg&as=picture'));
      expect(picture).toMatchObject({ sources: { webp: '#0 800w, #2 1600w' } });
    });

    it('warns only when clamping actually merged values', async () => {
      warnings = [];
      await runModule('?w=400;3000&format=webp');
      await runModule('?w=400;800&format=webp');
      expect(warnings).toEqual([]);
    });
  });

  describe('defaultDirectives and presets', () => {
    const meta = async (query: string, options: object) =>
      exported(await runModule(`${query}&as=metadata:width;format`, options));

    it('applies defaultDirectives, as a query string or an object', async () => {
      expect(await meta('?w=300', { defaultDirectives: 'format=webp' })).toEqual({
        width: 300,
        format: 'webp',
      });
      expect(await meta('?w=300', { defaultDirectives: { format: 'avif' } })).toMatchObject({
        format: 'avif',
      });
    });

    it('lets the query override a default', async () => {
      expect(await meta('?w=300&format=png', { defaultDirectives: 'format=webp' })).toMatchObject({
        format: 'png',
      });
    });

    it('expands preset=<name>', async () => {
      const presets = { thumb: 'w=120&format=webp' };
      expect(await meta('?preset=thumb', { presets })).toEqual({ width: 120, format: 'webp' });
    });

    it('layers defaults, then the preset, then the query', async () => {
      const options = {
        defaultDirectives: 'format=jpg&w=999',
        presets: { thumb: { w: '120', format: 'webp' } },
      };
      expect(await meta('?preset=thumb&w=200', options)).toEqual({ width: 200, format: 'webp' });
    });

    it('fails the build on an unknown preset, listing the defined ones', async () => {
      await expect(runModule('?preset=nope', { presets: { thumb: 'w=120' } })).rejects.toThrow(
        'Unknown imagetools preset "nope". Defined presets: thumb.',
      );
      await expect(runModule('?preset=nope')).rejects.toThrow('No presets are defined.');
    });
  });

  describe('include and exclude', () => {
    // the test context's root is the image's directory, so the source's relative path is hero.jpg
    const handBack = 'export { default } from "./hero.jpg";\n';

    it('hands an excluded import back to Next.js', async () => {
      expect(await runModule('?w=300&format=webp', { exclude: ['*.jpg'] })).toBe(handBack);
    });

    it('hands back an import that include does not match', async () => {
      expect(await runModule('?w=300&format=webp', { include: ['assets/**'] })).toBe(handBack);
    });

    it('processes an import that include matches and exclude does not', async () => {
      const code = await runModule('?w=300&format=webp', {
        include: ['**/*.jpg'],
        exclude: ['raw/**'],
      });
      expect(code).toMatch(/tpit_ext=webp/);
    });
  });

  describe('named exports', () => {
    const names = (code: string) => [...code.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);

    it('exports the keys of a single metadata object by name', async () => {
      const code = await runModule('?w=300&format=webp&as=metadata');
      expect(names(code)).toEqual(expect.arrayContaining(['src', 'width', 'height', 'format']));
      expect(code).toMatch(/^export const width = __tpit_value\["width"\];$/m);
    });

    it('exports sources and img for as=picture', async () => {
      expect(names(await runModule('?w=300&format=webp;jpg&as=picture'))).toEqual([
        'sources',
        'img',
      ]);
    });

    it('exports nothing by name for arrays and strings', async () => {
      expect(names(await runModule('?w=300;400&format=webp&as=metadata'))).toEqual([]);
      expect(names(await runModule('?w=300&format=webp'))).toEqual([]);
      expect(names(await runModule('?w=300;400&format=webp&as=srcset'))).toEqual([]);
    });

    it('can be turned off', async () => {
      const code = await runModule('?w=300&format=webp&as=metadata', { namedExports: false });
      expect(names(code)).toEqual([]);
    });
  });

  describe('inline', () => {
    const decode = (dataUrl: string) => sharp(Buffer.from(dataUrl.split(',')[1]!, 'base64'));

    it('returns a data URL and imports no asset', async () => {
      const code = await runModule('?w=20&format=webp&inline');
      expect(code).not.toMatch(/^import /m);
      const url = exported(code) as string;
      expect(url).toMatch(/^data:image\/webp;base64,/);
      expect(await decode(url).metadata()).toMatchObject({ format: 'webp', width: 20 });
    });

    it('uses image/jpeg for jpg', async () => {
      expect(exported(await runModule('?w=20&format=jpg&inline'))).toMatch(
        /^data:image\/jpeg;base64,/,
      );
    });

    it('works with every output format, e.g. a srcset of data URLs', async () => {
      const srcset = exported(await runModule('?w=20;40&format=webp&as=srcset&inline')) as string;
      expect(srcset).toMatch(/^data:image\/webp;base64,\S+ 20w, data:image\/webp;base64,\S+ 40w$/);
    });

    it('shares the cache entry with the same variant imported normally', async () => {
      await runModule('?w=21&format=webp');
      const entries = readdirSync(cacheDir).length;
      await runModule('?w=21&format=webp&inline');
      expect(readdirSync(cacheDir)).toHaveLength(entries);
    });
  });

  describe('cache options', () => {
    const freshDir = () => mkdtempSync(path.join(tmpdir(), 'tpit-cache-'));
    const hourAgo = () => new Date(Date.now() - 3600_000);

    it('writes nothing when disabled', async () => {
      const dir = freshDir();
      try {
        await runModule('?w=211&format=webp', { cache: { dir, enabled: false } });
        expect(readdirSync(dir)).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('removes entries unused for longer than retention, and keeps the rest', async () => {
      const dir = freshDir();
      try {
        writeFileSync(path.join(dir, 'stale'), 'x');
        utimesSync(path.join(dir, 'stale'), hourAgo(), hourAgo());
        writeFileSync(path.join(dir, 'recent'), 'x');
        await runModule('?w=212&format=webp', { cache: { dir, retention: 60 } });
        const left = readdirSync(dir);
        expect(left).not.toContain('stale');
        expect(left).toContain('recent');
        expect(left).toHaveLength(2); // `recent` plus the entry just written
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('marks an entry as used on every hit, so retention only drops unused ones', async () => {
      const dir = freshDir();
      try {
        await runModule('?w=213&format=webp', { cache: { dir } });
        const [entry] = readdirSync(dir);
        const file = path.join(dir, entry!);
        utimesSync(file, hourAgo(), hourAgo());
        await runModule('?w=213&format=webp', { cache: { dir } });
        expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(60_000);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('caches separately per removeMetadata setting', async () => {
    const before = readdirSync(cacheDir).length;
    await runModule('?w=123&format=webp');
    const afterFirst = readdirSync(cacheDir).length;
    await runModule('?w=123&format=webp', { removeMetadata: false });
    expect(afterFirst).toBe(before + 1);
    expect(readdirSync(cacheDir)).toHaveLength(afterFirst + 1);
  });

  it('clamps widths to the source unless allowUpscale', async () => {
    const clamped = await runModule('?w=400;9000&format=webp');
    expect(clamped).toMatch(/w=1600/);
    expect(clamped).not.toMatch(/w=9000/);
    expect(await runModule('?w=2000&format=webp&allowUpscale=true')).toMatch(/w=2000/);
  });
});

describe('asset loader', () => {
  it('returns the encoded bytes for one config, also after `as` renamed the path', async () => {
    const query = '?tpit=x&tpit_ext=webp&w=300&format=webp';
    for (const resourcePath of [HERO, `${HERO}.webp`]) {
      const bytes = (await assetLoader.default.call(context(query, resourcePath))) as Buffer;
      const meta = await sharp(bytes).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 300 });
    }
  });
});
