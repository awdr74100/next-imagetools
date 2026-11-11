// Calls the built loaders directly with a minimal loader context, without Next.js. Fast checks of
// what the loader emits; the build/dev/mode suites cover what Turbopack does with it.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dist = path.resolve(import.meta.dirname, '../dist');
type Loader = { default: (this: object) => Promise<string | Buffer>; raw?: boolean };
const moduleLoader = require(path.join(dist, 'loader.cjs')) as Loader;
const assetLoader = require(path.join(dist, 'asset-loader.cjs')) as Loader;

// Each run gets its own source image and cache, so the unit suite never touches the e2e fixture.
const workDir = mkdtempSync(path.join(tmpdir(), 'nit-unit-'));
const HERO = path.join(workDir, 'images', 'hero.jpg');
const cacheDir = path.join(workDir, 'cache');
beforeAll(async () => {
  mkdirSync(path.dirname(HERO), { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  // 1600x1000 and blue, which the clamping and color assertions below rely on
  await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toFile(HERO);
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

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
      .match(/const __nit_value = (.*);\n/)![1]!
      .replaceAll(/" \+ __nit_url\(__nit_(\d+)\) \+ "/g, '#$1'),
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
    const pair = await runModule('?w=400;800&format=webp');
    const entries = readdirSync(cacheDir).length;
    expect(await runModule('?w=400&format=webp&imagetools')).toBe(plain);
    expect(await runModule('?w=400;800&format=webp&imagetools-gallery')).toBe(pair);
    expect(readdirSync(cacheDir)).toHaveLength(entries);
    expect(plain).not.toMatch(/imagetools/);
  });

  it('fails the build when a type marker disagrees with what the import gives', async () => {
    await expect(runModule('?w=400;800&format=webp&imagetools')).rejects.toThrow(
      'next-imagetools: hero.jpg?w=400;800&format=webp&imagetools: the query gives 2 images, ' +
        'an array, but &imagetools types it as a single value. End it with &imagetools-gallery.',
    );
    // the count includes what a preset adds
    await expect(
      runModule('?preset=pair&imagetools', { presets: { pair: 'w=400;800&format=webp' } }),
    ).rejects.toThrow(/gives 2 images/);
    await expect(runModule('?w=400&format=webp&as=img&imagetools')).rejects.toThrow(
      /as=img is typed without a marker/,
    );
    await expect(
      runModule('?preset=pair&imagetools-gallery', { presets: { pair: 'w=400;800&format=webp' } }),
    ).resolves.toBeTypeOf('string');
  });

  it('one asset import per resolved config, carrying the output extension', async () => {
    const code = await runModule('?w=300;600&format=avif;webp');
    const imports = [...code.matchAll(/import __nit_\d+ from "([^"]+)"/g)].map(m => m[1]);
    expect(imports).toHaveLength(4);
    expect(imports.filter(i => i?.includes('nit_ext=avif'))).toHaveLength(2);
    expect(imports.filter(i => i?.includes('nit_ext=webp'))).toHaveLength(2);
  });

  it('as=metadata:<keys> keeps only those keys', async () => {
    const code = await runModule('?w=300&format=webp&as=metadata:width;height');
    const value = code.match(/const __nit_value = (.*);\n/)?.[1];
    expect(value).toBe('{"width":300,"height":188}');
  });

  describe('as=picture (as the README documents it)', () => {
    it('uses the last format as fallback, without a source when it has one size', async () => {
      const code = await runModule('?w=300&format=avif;webp;jpg&as=picture');
      expect(code).toMatch(/"sources":\{"avif":"[^}]*","webp":"[^}]*"\}/);
      expect(code).not.toMatch(/"sources":\{[^}]*"jpe?g"/);
      expect(code).toMatch(/"img":\{"src":"" \+ __nit_url\(__nit_2\)/);
    });

    it('gives the fallback format a source too when it has several sizes, keyed jpeg', async () => {
      const value = exported(await runModule('?w=400;800&format=avif;webp;jpg&as=picture')) as {
        sources: Record<string, string>;
        img: { w: number };
      };
      expect(Object.keys(value.sources)).toEqual(['avif', 'webp', 'jpeg']);
      expect(value.img.w).toBe(800);
    });
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
      expect(code).toMatch(/nit_ext=webp/);
    });
  });

  describe('named exports', () => {
    const names = (code: string) => [...code.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);

    it('exports the keys of a single metadata object by name', async () => {
      const code = await runModule('?w=300&format=webp&as=metadata');
      expect(names(code)).toEqual(expect.arrayContaining(['src', 'width', 'height', 'format']));
      expect(code).toMatch(/^export const width = __nit_value\["width"\];$/m);
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

  describe('configFile', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'nit-config-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    let n = 0;
    /** Writes a config module and returns its absolute path (resolved as-is by the loader). */
    const writeConfig = (source: string, name = `config-${n++}.mjs`) => {
      const file = path.join(dir, name);
      writeFileSync(file, source);
      return file;
    };
    // a transform factory that applies when the `mono` directive is present
    const mono = (body: string) =>
      `const mono = cfg => ('mono' in cfg ? (state, image) => ${body} : undefined);`;

    it('adds output formats', async () => {
      const configFile = writeConfig(
        `export default { extendOutputFormats: b => ({ ...b, dims: () => imgs => imgs.map(i => ({ w: i.info.width })) }) };`,
      );
      expect(exported(await runModule('?w=300;400&format=webp&as=dims', { configFile }))).toEqual([
        { w: 300 },
        { w: 400 },
      ]);
    });

    it('adds transforms', async () => {
      const configFile = writeConfig(
        `${mono('image.grayscale()')}\nexport default { extendTransforms: b => [...b, mono] };`,
      );
      const code = await runModule('?w=40&format=png&mono', { configFile });
      const [r, g, b] = await pixelWith(code, { configFile });
      expect(r).toBe(g);
      expect(g).toBe(b);
    });

    it('replaces resolveConfigs', async () => {
      const configFile = writeConfig(
        `export default { resolveConfigs: () => [{ w: '77', format: 'webp' }] };`,
      );
      expect(exported(await runModule('?w=300;400&as=metadata:width', { configFile }))).toEqual({
        width: 77,
      });
    });

    it('takes defaultDirectives as a function of the image, beneath the query', async () => {
      const configFile = writeConfig(
        `export default { defaultDirectives: async (url, metadata) => new URLSearchParams(
          (await metadata()).width > 1000 && url.search.includes('w=') ? 'format=webp' : 'format=png') };`,
      );
      expect(exported(await runModule('?w=300&as=metadata:format', { configFile }))).toEqual({
        format: 'webp',
      });
      expect(
        exported(await runModule('?w=300&format=jpg&as=metadata:format', { configFile })),
      ).toEqual({ format: 'jpg' });
    });

    it('picks up an edited config file, without serving cached output of the old one', async () => {
      const name = 'edited.mjs';
      const options = {
        configFile: writeConfig(
          `${mono('image')}\nexport default { extendTransforms: b => [...b, mono] };`,
          name,
        ),
      };
      const colored = await runModule('?w=41&format=png&mono', options);
      const [r1, g1] = await pixelWith(colored, options);
      expect(r1).not.toBe(g1); // the source is blue: no-op transform keeps it colored

      writeConfig(
        `${mono('image.grayscale()')}\nexport default { extendTransforms: b => [...b, mono] };`,
        name,
      );
      const gray = await runModule('?w=41&format=png&mono', options);
      const [r2, g2, b2] = await pixelWith(gray, options);
      expect(r2).toBe(g2);
      expect(g2).toBe(b2);
    });

    it('runs the config file example from the README as written', async () => {
      const readme = readFileSync(path.resolve(import.meta.dirname, '../README.md'), 'utf8');
      const example = readme.match(/```js\n\/\/ imagetools\.config\.mjs\n([\s\S]*?)```/)?.[1];
      expect(example, 'the README example').toBeTruthy();
      // point the package import at the build, which is what it resolves to in a user's app
      const configFile = path.join(workDir, 'readme-example.mjs');
      const configEntry = pathToFileURL(path.join(dist, 'config.mjs')).href;
      writeFileSync(configFile, example!.replace("'next-imagetools/config'", `'${configEntry}'`));
      try {
        const sizes = exported(await runModule('?w=300;400&as=sizes', { configFile }));
        expect(sizes).toEqual([
          { src: '#0', width: 300 },
          { src: '#1', width: 400 },
        ]);
        // the source has no alpha channel, so the example's defaultDirectives picks avif
        expect(exported(await runModule('?w=50&as=metadata:format', { configFile }))).toEqual({
          format: 'avif',
        });
        const sepia = await pixelWith(await runModule('?w=50&format=png&sepia', { configFile }), {
          configFile,
        });
        const plain = await pixelWith(await runModule('?w=50&format=png', { configFile }), {
          configFile,
        });
        expect(sepia).not.toEqual(plain);
      } finally {
        rmSync(configFile, { force: true });
      }
    });

    it('registers the config file as a dependency', async () => {
      const configFile = writeConfig('export default {};');
      const deps: string[] = [];
      await moduleLoader.default.call({
        ...context('?w=42&format=webp', HERO, { configFile }),
        addDependency: (f: string) => deps.push(f),
      });
      expect(deps).toContain(configFile);
    });

    it('fails clearly when the config file is missing', async () => {
      await expect(
        runModule('?w=43&format=webp', { configFile: path.join(dir, 'nope.mjs') }),
      ).rejects.toThrow(/configFile not found at .*nope\.mjs/);
    });

    async function pixelWith(code: string, options: object) {
      const query = code.match(/"\.\/hero\.jpg(\?[^"]+)"/)![1]!;
      const bytes = (await assetLoader.default.call(context(query, HERO, options))) as Buffer;
      const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    }
  });

  describe('diagnostics', () => {
    it('warns about an unknown directive, and still produces the image', async () => {
      warnings = [];
      const code = await runModule('?widht=300&format=webp');
      expect(warnings).toEqual([
        'hero.jpg?widht=300&format=webp: Unknown directive "widht" has no effect. Did you mean w?',
      ]);
      expect(code).toMatch(/nit_ext=webp/);
    });

    it('emits warnings without a stack trace, since Turbopack prints it under the message', async () => {
      const emitted: Error[] = [];
      await moduleLoader.default.call({
        ...context('?widht=300&format=webp'),
        emitWarning: (e: Error) => emitted.push(e),
      });
      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.name).toBe('next-imagetools');
      expect(emitted[0]!.stack).toBe(`next-imagetools: ${emitted[0]!.message}`);
    });

    it('fails on an unknown output format, naming the file and query', async () => {
      await expect(runModule('?w=300&as=piture')).rejects.toThrow(
        'next-imagetools: hero.jpg?w=300&as=piture: Unknown output format as=piture. Did you mean as=picture?',
      );
    });

    it.each([
      ['?w=abc&format=webp', 'w=abc is not valid'],
      ['?w=300&format=jxl', 'format=jxl is not valid'],
      ['?w=300&quality=200', 'quality=200 is not valid'],
    ])('fails on %s', async (query, message) => {
      await expect(runModule(query)).rejects.toThrow(`hero.jpg${query}: ${message}`);
    });

    it('names the file when the source is not an image, in both loaders', async () => {
      const broken = path.join(path.dirname(HERO), 'broken.jpg');
      writeFileSync(broken, 'not an image');
      await expect(moduleLoader.default.call(context('?w=10&format=webp', broken))).rejects.toThrow(
        'next-imagetools: broken.jpg?w=10&format=webp: Input buffer contains',
      );
      await expect(
        assetLoader.default.call(context('?nit=x&nit_ext=webp&w=10&format=webp', broken)),
      ).rejects.toThrow('next-imagetools: broken.jpg?nit=x&nit_ext=webp&w=10&format=webp:');
    });

    it('handles file names that need escaping, and encodes the URLs it exports', async () => {
      const spaced = path.join(path.dirname(HERO), 'my photo (1) & café.jpg');
      writeFileSync(spaced, readFileSync(HERO));
      const code = (await moduleLoader.default.call(
        context('?w=40&format=webp', spaced),
      )) as string;
      expect(code).toContain('from "./my photo (1) & café.jpg?nit=');
      // a space would otherwise split a srcset entry; Turbopack returns the path unencoded
      expect(code).toContain('const __nit_url = (m) => encodeURI(');
    });

    it('ignores a stray separator instead of adding an empty variant', async () => {
      expect(exported(await runModule('?w=300&format=webp;'))).toBe('#0');
    });

    it('uses the last value of a repeated directive', async () => {
      expect(exported(await runModule('?w=100&w=200&as=metadata:width'))).toEqual({ width: 200 });
    });

    it('re-encodes the source when the query has only a type marker', async () => {
      expect(exported(await runModule('?imagetools&as=metadata:width'))).toEqual({ width: 1600 });
    });

    it('does not warn about keys the config file defaultDirectives reads', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'nit-consumed-'));
      try {
        const configFile = path.join(dir, 'config.mjs');
        writeFileSync(
          configFile,
          `export default { defaultDirectives: url => new URLSearchParams(url.searchParams.has('hero') ? 'w=640' : '') };`,
        );
        warnings = [];
        const value = exported(
          await runModule('?hero&format=webp&as=metadata:width', { configFile }),
        );
        expect(value).toEqual({ width: 640 });
        expect(warnings).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('as=next and placeholder', () => {
    type Blurred = { blurDataURL: string; blurWidth: number; blurHeight: number };
    const decode = (dataUrl: string) =>
      sharp(Buffer.from(dataUrl.split(',')[1]!, 'base64')).metadata();

    it('as=next has the shape of a Next.js static image import, for the largest variant', async () => {
      const value = exported(await runModule('?w=400;800&format=webp&as=next')) as Blurred & {
        src: string;
        width: number;
        height: number;
      };
      expect(value).toMatchObject({
        src: '#1',
        width: 800,
        height: 500,
        blurWidth: 8,
        blurHeight: 5,
      });
      expect(await decode(value.blurDataURL)).toMatchObject({
        format: 'webp',
        width: 8,
        height: 5,
      });
    });

    it('sizes the blur by the longer side, like Next.js, also for portrait images', async () => {
      const value = exported(
        await runModule('?w=100&h=400&fit=cover&format=webp&as=next'),
      ) as Blurred;
      expect([value.blurWidth, value.blurHeight]).toEqual([2, 8]);
    });

    it('adds a blurred placeholder to object outputs, matching the cropped variant', async () => {
      const value = exported(
        await runModule('?w=300&h=300&fit=cover&format=webp&placeholder&as=img'),
      ) as { placeholder: string };
      expect(await decode(value.placeholder)).toMatchObject({ width: 8, height: 8 });
    });

    it('placeholder=color gives the dominant color', async () => {
      // the unit source is a flat blue: 30, 120, 200
      const value = exported(
        await runModule('?w=400;800&format=webp;jpg&placeholder=color&as=picture'),
      ) as { placeholder: string };
      expect(value.placeholder).toMatch(/^#[0-9a-f]{6}$/);
      const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(value.placeholder.slice(i, i + 2), 16));
      expect(Math.abs(r! - 30) + Math.abs(g! - 120) + Math.abs(b! - 200)).toBeLessThan(40);
    });

    it('works with as=metadata', async () => {
      const value = exported(
        await runModule('?w=300&format=webp&placeholder=blur&as=metadata:width'),
      ) as { width: number; placeholder: string };
      expect(value.width).toBe(300);
      expect(value.placeholder).toMatch(/^data:image\/webp;base64,/);
    });

    it.each([
      ['?w=300&format=webp&placeholder', 'a URL string'],
      ['?w=300;600&format=webp&placeholder&as=srcset', 'a srcset string'],
      ['?w=300;600&format=webp&placeholder&as=metadata', 'an array'],
    ])('rejects %s, which gives %s', async query => {
      await expect(runModule(query)).rejects.toThrow('placeholder needs a single object result');
    });

    it('rejects an unknown placeholder kind', async () => {
      await expect(runModule('?w=300&format=webp&placeholder=fuzzy&as=img')).rejects.toThrow(
        'placeholder=fuzzy is not valid',
      );
    });

    it('does not change the cache entries of the image it describes', async () => {
      await runModule('?w=222&format=webp&as=img');
      const entries = readdirSync(cacheDir).length;
      await runModule('?w=222&format=webp&placeholder&as=img');
      expect(readdirSync(cacheDir)).toHaveLength(entries);
    });
  });

  describe('animated sources', () => {
    // two 200x100 frames: red, then blue
    let animated: string;
    beforeAll(async () => {
      animated = path.join(path.dirname(HERO), 'anim.gif');
      const frame = (background: string) =>
        sharp({ create: { width: 200, height: 100, channels: 3, background } })
          .png()
          .toBuffer();
      await sharp([await frame('#ff0000'), await frame('#0000ff')], { join: { animated: true } })
        .gif({ delay: [200, 200] })
        .toFile(animated);
    });

    const output = async (query: string, file = animated) => {
      const code = (await moduleLoader.default.call(context(query, file))) as string;
      const sub = code.match(/"\.\/[^"?]+(\?[^"]+)"/)![1]!;
      return (await assetLoader.default.call(context(sub, file))) as Buffer;
    };
    /** Each frame's size and the color at its center. */
    const frames = async (bytes: Buffer) => {
      const { pages = 1 } = await sharp(bytes).metadata();
      return Promise.all(
        Array.from({ length: pages }, async (_, page) => {
          const image = sharp(bytes, { page });
          const { width, height } = await image.metadata();
          const { data } = await image
            .extract({
              left: Math.floor(width / 2),
              top: Math.floor(height / 2),
              width: 1,
              height: 1,
            })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          return { width, height, color: data[0]! > data[2]! ? 'red' : 'blue' };
        }),
      );
    };

    it.each(['webp', 'gif'])(
      'keeps every frame, each resized to the right aspect, as %s',
      async format => {
        expect(await frames(await output(`?w=100&format=${format}`))).toEqual([
          { width: 100, height: 50, color: 'red' },
          { width: 100, height: 50, color: 'blue' },
        ]);
      },
    );

    it('crops every frame', async () => {
      expect(await frames(await output('?w=60&h=60&fit=cover&format=webp'))).toEqual([
        { width: 60, height: 60, color: 'red' },
        { width: 60, height: 60, color: 'blue' },
      ]);
    });

    it('reports one frame in metadata, with the frame count', async () => {
      const code = await moduleLoader.default.call(
        context('?w=100&format=webp&as=metadata:width;height;pages', animated),
      );
      expect(exported(code as string)).toEqual({ width: 100, height: 50, pages: 2 });
    });

    it('keeps the first frame, and warns, for a format without frames', async () => {
      warnings = [];
      expect(await frames(await output('?w=100&format=png'))).toEqual([
        { width: 100, height: 50, color: 'red' },
      ]);
      expect(warnings).toEqual([
        "anim.gif?w=100&format=png: the source has 2 frames, but png can't be animated, so only " +
          'the first frame is kept. Use format=webp or format=gif to keep the animation.',
      ]);
    });

    it('does not warn for a still source', async () => {
      warnings = [];
      await runModule('?w=100&format=png');
      expect(warnings).toEqual([]);
    });

    it('treats a multi-page TIFF as a still image, not an animation', async () => {
      // pages, like an animation, but no frame delays
      const tiff = path.join(path.dirname(HERO), 'pages.tiff');
      await sharp(
        [
          await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } })
            .png()
            .toBuffer(),
          await sharp({ create: { width: 200, height: 100, channels: 3, background: '#0000ff' } })
            .png()
            .toBuffer(),
        ],
        { join: { animated: true } },
      )
        .tiff()
        .toFile(tiff);
      expect((await sharp(tiff).metadata()).pages).toBe(2);

      warnings = [];
      expect(await frames(await output('?w=100&format=webp', tiff))).toEqual([
        { width: 100, height: 50, color: 'red' },
      ]);
      await output('?w=100&format=png', tiff);
      expect(warnings).toEqual([]);
    });
  });

  describe('EXIF-rotated sources', () => {
    // stored 400x300 with orientation 6, as phones save portraits: shown 300x400
    let portrait: string;
    beforeAll(async () => {
      portrait = path.join(path.dirname(HERO), 'portrait.jpg');
      await sharp({ create: { width: 400, height: 300, channels: 3, background: '#cc3333' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toFile(portrait);
    });
    const run = async (query: string) =>
      exported((await moduleLoader.default.call(context(query, portrait))) as string);

    it('clamps to the upright size, which imagetools-core resizes', async () => {
      // the stored height (300) would cap h=350 although the image is 400 tall
      expect(await run('?h=350&as=metadata:width;height')).toEqual({ width: 263, height: 350 });
      expect(await run('?w=350&as=metadata:width;height')).toEqual({ width: 300, height: 400 });
    });

    it('lists an upright width once, and warns when values merge', async () => {
      warnings = [];
      expect(await run('?w=300;350&format=webp&as=srcset')).toBe('#0 300w');
      expect(warnings).toEqual([
        "portrait.jpg?w=300;350&format=webp&as=srcset: w=300;350 goes beyond the source's 300px, " +
          'so some variants come out identical. Remove the extra values, or add allowUpscale=true ' +
          'to scale up.',
      ]);
    });

    it('clamps to the stored size with noAutoOrient, which keeps the image as stored', async () => {
      expect(await run('?w=350&noAutoOrient&as=metadata:width;height')).toEqual({
        width: 350,
        height: 263,
      });
    });
  });

  describe('cache options', () => {
    const freshDir = () => mkdtempSync(path.join(tmpdir(), 'nit-cache-'));
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
    const query = '?nit=x&nit_ext=webp&w=300&format=webp';
    for (const resourcePath of [HERO, `${HERO}.webp`]) {
      const bytes = (await assetLoader.default.call(context(query, resourcePath))) as Buffer;
      const meta = await sharp(bytes).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 300 });
    }
  });
});
