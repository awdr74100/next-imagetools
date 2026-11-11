// withImagetools() only rewrites next.config, so it is tested as a plain function on the built
// package. What Turbopack then does with the rules is covered by the build/dev/mode suites.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Package from '../packages/turbopack-imagetools/dist/index.cjs';

// `next` is only installed in the package and the fixture, so take its config type from the
// package's own declarations
type NextConfig = NonNullable<Parameters<typeof Package.withImagetools>[0]>;

const require = createRequire(import.meta.url);
const { withImagetools } = require(
  path.resolve(import.meta.dirname, '../packages/turbopack-imagetools/dist/index.cjs'),
) as typeof Package;

type Rule = { loaders?: unknown[]; condition?: unknown; as?: string; type?: string };
const rulesFor = (config: NextConfig, key: string) =>
  config.turbopack?.rules?.[key] as Rule[] | undefined;

const isOurs = (r: Rule) => JSON.stringify(r.loaders ?? []).includes('turbopack-imagetools/');

describe('withImagetools', () => {
  it('adds rules for every default extension and passes the rest of the config through', () => {
    const config = withImagetools({ reactStrictMode: true, images: { unoptimized: true } });
    expect(config.reactStrictMode).toBe(true);
    expect(config.images).toEqual({ unoptimized: true });
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif']) {
      expect(rulesFor(config, `*.${ext}`)?.every(isOurs), ext).toBe(true);
    }
  });

  it('keeps unrelated rules and other turbopack options', () => {
    const config = withImagetools({
      turbopack: {
        resolveAlias: { a: 'b' },
        rules: { '*.svg': { loaders: ['@svgr/webpack'], as: '*.js' } },
      },
    });
    expect(config.turbopack?.resolveAlias).toEqual({ a: 'b' });
    expect(config.turbopack?.rules?.['*.svg']).toEqual({ loaders: ['@svgr/webpack'], as: '*.js' });
  });

  it('runs existing rules for the same extension first, in every shape Next.js accepts', () => {
    const own = { loaders: ['my-loader'], as: '*.js', condition: { query: /mine/ } };
    // a single rule, a list of rules, and the older shorthand of a bare loader list
    for (const existing of [own, [own], ['my-loader']] as const) {
      const rules = rulesFor(
        withImagetools({ turbopack: { rules: { '*.png': existing as never } } }),
        '*.png',
      )!;
      expect(isOurs(rules[0]!)).toBe(false);
      expect(rules.slice(1).every(isOurs)).toBe(true);
      expect(JSON.stringify(rules[0]!.loaders)).toContain('my-loader');
    }
  });

  it('renames an output only when its format differs from the source', () => {
    const rules = rulesFor(withImagetools({}), '*.jpg')!;
    const assetRule = (ext: string) =>
      rules.find(r =>
        String((r.condition as { query?: RegExp }).query).includes(`tpit_ext=${ext}(`),
      );
    expect(assetRule('jpg')?.as).toBeUndefined();
    expect(assetRule('webp')?.as).toBe('*.webp');
    // .jpeg sources output .jpg, which is a different extension
    const jpegRules = rulesFor(withImagetools({}), '*.jpeg')!;
    expect(
      jpegRules.find(r =>
        String((r.condition as { query?: RegExp }).query).includes('tpit_ext=jpg('),
      )?.as,
    ).toBe('*.jpg');
  });

  it('warns once when defaultDirectives would multiply every import', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      withImagetools({}, { defaultDirectives: 'quality=80&format=webp' });
      expect(warn).not.toHaveBeenCalled();
      withImagetools({}, { defaultDirectives: { format: 'avif;webp' } });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toMatch(/format=avif;webp/);
    } finally {
      warn.mockRestore();
    }
  });

  it('has an asset rule for every output format the directive check accepts', async () => {
    const { OUTPUT_FORMATS } = await import('../packages/turbopack-imagetools/src/directives');
    const rules = rulesFor(withImagetools({}), '*.png')!;
    for (const format of OUTPUT_FORMATS) {
      const ext = format === 'jpeg' ? 'jpg' : format;
      expect(
        rules.some(r =>
          String((r.condition as { query?: RegExp }).query).includes(`tpit_ext=${ext}(`),
        ),
        `asset rule for ${format}`,
      ).toBe(true);
    }
  });

  it('only handles the configured extensions', () => {
    const rules = withImagetools({}, { extensions: ['png'] }).turbopack?.rules ?? {};
    expect(Object.keys(rules)).toEqual(['*.png']);
  });

  it('passes loader options through as JSON, without the helper-only keys', () => {
    const rules = rulesFor(
      withImagetools(
        {},
        {
          cache: { dir: '.cache/x' },
          removeMetadata: false,
          namedExports: false,
          extensions: ['jpg'],
        },
      ),
      '*.jpg',
    )!;
    const options = rules.flatMap(r => (r.loaders as { options?: object }[]).map(l => l.options));
    for (const o of options)
      expect(o).toEqual({
        cache: { dir: '.cache/x' },
        removeMetadata: false,
        namedExports: false,
      });
  });

  it('does not mutate the config it was given', () => {
    const input: NextConfig = { turbopack: { rules: { '*.png': { loaders: ['x'] } } } };
    const snapshot = JSON.stringify(input);
    withImagetools(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('generated types (types: true)', () => {
  const loaderOptions = (config: NextConfig) =>
    rulesFor(config, '*.jpg')!.map(
      r => (r.loaders as { options: { typesDir?: string } }[])[0]!.options,
    );
  type Hook = (metadata: { projectDir: string; distDir: string }) => Promise<void>;
  const hookOf = (config: NextConfig) =>
    (config.compiler as { runAfterProductionCompile?: Hook } | undefined)
      ?.runAfterProductionCompile;

  // inside the repo, so the hook resolves typescript the way it would from an app
  const dirs: string[] = [];
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(path.join(import.meta.dirname, '.tmp-types-'));
    dirs.push(dir);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    return dir;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('are off by default: no typesDir for the loaders, no build hook', () => {
    const config = withImagetools({}, { extensions: ['jpg'] });
    for (const o of loaderOptions(config)) expect(o.typesDir).toBeUndefined();
    expect(config.compiler).toBeUndefined();
  });

  it('go under the distDir, where Next.js keeps its own', () => {
    const typesDir = (config: NextConfig) =>
      new Set(
        loaderOptions(withImagetools(config, { extensions: ['jpg'], types: true })).map(
          o => o.typesDir,
        ),
      );
    expect(typesDir({})).toEqual(new Set(['.next/types/turbopack-imagetools']));
    expect(typesDir({ distDir: 'build' })).toEqual(new Set(['build/types/turbopack-imagetools']));
  });

  it('add a post-compile hook that runs after the one the config had, keeping other compiler options', async () => {
    const calls: string[] = [];
    const dir = project({});
    const config = withImagetools(
      {
        compiler: {
          removeConsole: true,
          runAfterProductionCompile: async () => {
            calls.push('user');
          },
        },
      },
      { types: true },
    );
    expect(config.compiler).toMatchObject({ removeConsole: true });
    await hookOf(config)!({ projectDir: dir, distDir: path.join(dir, '.next') });
    expect(calls).toEqual(['user']);
  });

  it('are all written by the hook, which a warm build relies on; outdated ones are removed', async () => {
    const dir = project({
      'app/page.tsx': `import urls from '../images/a.jpg?w=1;2&format=webp';
export default urls;`,
      // as next build leaves it: emptied out, or holding an outdated declaration
      '.next/types/turbopack-imagetools/0123456789abcdef.d.ts': 'declare module "x" {}',
    });
    await hookOf(withImagetools({}, { types: true }))!({
      projectDir: dir,
      distDir: path.join(dir, '.next'),
    });
    const typesDir = path.join(dir, '.next/types/turbopack-imagetools');
    const files = readdirSync(typesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe('0123456789abcdef.d.ts');
    expect(readFileSync(path.join(typesDir, files[0]!), 'utf8')).toContain(
      'type Value = string[];',
    );
  });

  it('warn for a Pages Router app, whose build type-checks before any image is processed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pagesOnly = project({ 'pages/index.tsx': '' });
    const both = project({ 'src/app/page.tsx': '', 'src/pages/old.tsx': '' });
    const cwd = vi.spyOn(process, 'cwd');

    cwd.mockReturnValue(both);
    withImagetools({}, { types: true });
    cwd.mockReturnValue(pagesOnly);
    withImagetools({});
    expect(warn).not.toHaveBeenCalled();

    withImagetools({}, { types: true });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/needs the App Router/);
  });
});
