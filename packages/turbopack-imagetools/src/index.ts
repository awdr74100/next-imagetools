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

function imagetoolsRules(options: LoaderOptions): RuleCollection {
  return [
    // internal per-image import emitted by the module loader → encoded bytes as an asset,
    // renamed so the emitted file carries the output format's extension
    ...OUTPUT_EXTENSIONS.map(ext => ({
      condition: { query: new RegExp(`[?&]tpit_ext=${ext}(?=&|$)`) },
      loaders: [{ loader: 'turbopack-imagetools/asset-loader', options: { ...options } }],
      as: `*.${ext}`,
      type: 'asset' as const,
    })),
    // any other import with a query goes through imagetools
    {
      condition: { all: [{ query: /^\?.+/ }, { not: { query: /[?&]tpit=/ } }] },
      loaders: [{ loader: 'turbopack-imagetools/loader', options: { ...options } }],
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
 * Adds the imagetools rules to `turbopack.rules`. Rules the config already has for the same
 * extension are kept and run first.
 */
export function withImagetools(
  nextConfig: NextConfig = {},
  options: ImagetoolsOptions = {},
): NextConfig {
  const { extensions = DEFAULT_EXTENSIONS, ...loaderOptions } = options;
  const rules: TurbopackRules = { ...nextConfig.turbopack?.rules };
  for (const ext of extensions) {
    const key = `*.${ext}`;
    const existing = rules[key];
    const ours = toRules(imagetoolsRules(loaderOptions));
    rules[key] = existing === undefined ? ours : [...toRules(existing), ...ours];
  }
  return { ...nextConfig, turbopack: { ...nextConfig.turbopack, rules } };
}
