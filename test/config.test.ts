// withImagetools() only rewrites next.config, so it is tested as a plain function on the built
// package. What Turbopack then does with the rules is covered by the build/dev/mode suites.
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type * as Package from '../dist/index.cjs';

// `next` is only installed in the package and the fixture, so take its config type from the
// package's own declarations
type NextConfig = NonNullable<Parameters<typeof Package.withImagetools>[0]>;

const require = createRequire(import.meta.url);
const { withImagetools } = require(
  path.resolve(import.meta.dirname, '../dist/index.cjs'),
) as typeof Package;

type Rule = { loaders?: unknown[]; condition?: unknown; as?: string; type?: string };
const rulesFor = (config: NextConfig, key: string) =>
  config.turbopack?.rules?.[key] as Rule[] | undefined;

const isOurs = (r: Rule) => JSON.stringify(r.loaders ?? []).includes('next-imagetools/');

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
        String((r.condition as { query?: RegExp }).query).includes(`nit_ext=${ext}(`),
      );
    expect(assetRule('jpg')?.as).toBeUndefined();
    expect(assetRule('webp')?.as).toBe('*.webp');
    // .jpeg sources output .jpg, which is a different extension
    const jpegRules = rulesFor(withImagetools({}), '*.jpeg')!;
    expect(
      jpegRules.find(r =>
        String((r.condition as { query?: RegExp }).query).includes('nit_ext=jpg('),
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
    const { OUTPUT_FORMATS } = await import('../src/directives');
    const rules = rulesFor(withImagetools({}), '*.png')!;
    for (const format of OUTPUT_FORMATS) {
      const ext = format === 'jpeg' ? 'jpg' : format;
      expect(
        rules.some(r =>
          String((r.condition as { query?: RegExp }).query).includes(`nit_ext=${ext}(`),
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

  describe('webpack', () => {
    type WebpackRule = {
      test: RegExp;
      resourceQuery: RegExp;
      enforce?: string;
      loader?: string;
      options?: { webpack?: object; [key: string]: unknown };
    };
    type Context = Parameters<NonNullable<NextConfig['webpack']>>[1];
    const contextFor = (overrides: Partial<Context> = {}, config: object = {}) =>
      ({
        isServer: false,
        dev: false,
        config: { assetPrefix: '', ...config },
        ...overrides,
      }) as Context;
    const ruleOf = (config: NextConfig, context = contextFor()) => {
      const result = config.webpack!({ module: { rules: [] } }, context) as {
        module: { rules: WebpackRule[] };
      };
      return result.module.rules.at(-1)!;
    };

    it('adds an enforce: post rule for queried imports of the configured extensions', () => {
      const rule = ruleOf(withImagetools({}, { extensions: ['jpg', 'png'] }));
      expect(rule).toMatchObject({ enforce: 'post', loader: 'next-imagetools/loader' });
      expect(rule.test.test('/a/hero.jpg')).toBe(true);
      expect(rule.test.test('/a/hero.png')).toBe(true);
      expect(rule.test.test('/a/hero.webp')).toBe(false);
      expect(rule.resourceQuery.test('?w=400')).toBe(true);
      expect(rule.resourceQuery.test('')).toBe(false);
      // Next.js' metadata images (app/icon.png, opengraph-image.jpg) stay with Next.js
      expect(rule.resourceQuery.test('?__next_metadata__')).toBe(false);
      expect(rule.resourceQuery.test('?x=1&__next_metadata_image_meta__')).toBe(false);
    });

    it('tells the loader where each compiler emits and what URLs point there', () => {
      const config = withImagetools({}, { removeMetadata: false });
      expect(ruleOf(config).options).toEqual({
        removeMetadata: false,
        webpack: { compilerType: 'client', isDev: false, assetPrefix: '' },
      });
      const server = ruleOf(
        config,
        contextFor({ isServer: true, nextRuntime: 'nodejs', dev: true }, { assetPrefix: '/cdn' }),
      );
      expect(server.options?.webpack).toEqual({
        compilerType: 'server',
        isDev: true,
        assetPrefix: '/cdn',
      });
      const edge = ruleOf(
        config,
        contextFor({ isServer: true, nextRuntime: 'edge' }, { outputHashSalt: 's' }),
      );
      expect(edge.options?.webpack).toMatchObject({
        compilerType: 'edge-server',
        outputHashSalt: 's',
      });
    });

    it('runs a webpack() function the config already has, then adds the rule', () => {
      const own = { test: /\.svg$/, loader: '@svgr/webpack' };
      const config = withImagetools({
        webpack: (webpackConfig: { module: { rules: object[] } }) => {
          webpackConfig.module.rules.push(own);
          return webpackConfig;
        },
      });
      const result = config.webpack!({ module: { rules: [] } }, contextFor()) as {
        module: { rules: WebpackRule[] };
      };
      expect(result.module.rules[0]).toBe(own);
      expect(result.module.rules[1]?.loader).toBe('next-imagetools/loader');
    });

    it('creates module.rules when the config has none', () => {
      const result = withImagetools({}).webpack!({}, contextFor()) as {
        module: { rules: unknown[] };
      };
      expect(result.module.rules).toHaveLength(1);
    });
  });
});
