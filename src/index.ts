import type { NextConfig } from 'next';

import type { LoaderOptions } from './shared';

export interface ImagetoolsOptions extends LoaderOptions {
  /** Source extensions handled by imagetools. Imports without a query are left to Next.js. */
  extensions?: string[];
}

type TurbopackRules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>;
type RuleCollection = TurbopackRules[string];

const DEFAULT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'];
const OUTPUT_EXTENSIONS = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'];

function imagetoolsRules(options: LoaderOptions, sourceExt: string): RuleCollection {
  return [
    // internal per-image import emitted by the module loader → encoded bytes as an asset.
    // When the output format differs from the source's, the module is renamed so the emitted
    // file carries the right extension. Turbopack's `as` replaces `*` with the whole file name,
    // so that gives `hero.jpg.webp`; a same-format output skips the rename and stays `hero.jpg`.
    ...OUTPUT_EXTENSIONS.map(ext => {
      const rule: RuleItem = {
        condition: { query: new RegExp(`[?&]nit_ext=${ext}(?=&|$)`) },
        loaders: [{ loader: 'next-imagetools/asset-loader', options: { ...options } }],
        type: 'asset',
      };
      if (ext !== sourceExt) rule.as = `*.${ext}`;
      return rule;
    }),
    // any other import with a query goes through imagetools
    {
      condition: { all: [{ query: /^\?.+/ }, { not: { query: /[?&]nit=/ } }] },
      loaders: [{ loader: 'next-imagetools/loader', options: { ...options } }],
      as: '*.js',
    },
  ];
}

type RuleEntry = Extract<RuleCollection, unknown[]>[number];
type RuleItem = Exclude<RuleEntry, string | { loader: string }>;

const isLoaderItem = (e: RuleEntry): boolean => typeof e === 'string' || 'loader' in e;

/**
 * A collection is one rule, a list of rules, or (the older shorthand) a bare list of loaders.
 * Normalize to a list of rules so ours can be appended without turning into extra loaders.
 */
function toRules(collection: RuleCollection): RuleItem[] {
  if (!Array.isArray(collection)) return [collection];
  if (collection.length > 0 && collection.every(isLoaderItem)) {
    return [{ loaders: collection as Extract<RuleEntry, string | { loader: string }>[] }];
  }
  return collection.filter((e): e is RuleItem => !isLoaderItem(e));
}

/**
 * Several values in a default (`format=avif;webp`) multiply the images of every import, which turns
 * single values into arrays across the whole app and silently invalidates the `&imagetools` type
 * markers. Allowed, but worth saying once when the config loads.
 */
function warnOnMultiValueDefaults(defaults: ImagetoolsOptions['defaultDirectives']) {
  if (defaults === undefined) return;
  const multi = [...new URLSearchParams(defaults)].filter(([, v]) => v.includes(';'));
  if (multi.length === 0) return;
  console.warn(
    `[next-imagetools] defaultDirectives sets several values for ${multi
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}. Every import then produces several images, so imports that would give a ` +
      `single value give an array instead, and \`&imagetools\` type markers no longer match.`,
  );
}

/**
 * Adds the imagetools rules to `turbopack.rules`. Rules the config already has for the same
 * extension are kept and run first.
 */
export function withImagetools(
  nextConfig: NextConfig = {},
  options: ImagetoolsOptions = {},
): NextConfig {
  const { extensions = DEFAULT_EXTENSIONS, ...userOptions } = options;
  const loaderOptions: LoaderOptions = { ...userOptions };
  warnOnMultiValueDefaults(loaderOptions.defaultDirectives);
  const rules: TurbopackRules = { ...nextConfig.turbopack?.rules };
  for (const ext of extensions) {
    const key = `*.${ext}`;
    const existing = rules[key];
    const ours = toRules(imagetoolsRules(loaderOptions, ext));
    rules[key] = existing === undefined ? ours : [...toRules(existing), ...ours];
  }
  return { ...nextConfig, turbopack: { ...nextConfig.turbopack, rules } };
}
