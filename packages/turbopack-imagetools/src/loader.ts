// imagetools loader for Turbopack.
//
// Turbopack has no emitFile, and files written mid-build are not visible to its resolver, so for
// every generated image the module imports the source again as `<file>?tpit=…&<config>`. That
// import is matched by a rule with `type: 'asset'` whose loader (asset-loader.ts) returns the
// encoded bytes, and Turbopack's own asset pipeline hashes and emits them.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  builtinOutputFormats,
  extractEntries,
  resolveConfigs,
  urlFormat,
  type Logger,
  type ProcessedImage,
} from 'imagetools-core';
import picomatch from 'picomatch';
import sharp from 'sharp';

import {
  MARKER,
  prepareCache,
  hash,
  processImage,
  toParams,
  type LoaderContext,
  type LoaderOptions,
} from './shared';

const PLACEHOLDER = (i: number) => `__TPIT_${i}__`;
const TYPE_MARKERS = ['imagetools', 'imagetools-gallery'];

// "300;9000" against a 1600px source → "300;1600". Values that clamp to the same size are kept,
// not merged: how many images an import produces — and so whether it gives a value or an array —
// must follow from the query alone, not from the size of the file it points at. (vite-imagetools
// merges them, so a smaller source can turn an array into a single value.)
const clamp = (s: string, n: number) =>
  s
    .split(';')
    .map(d => (Number.parseInt(d) <= n ? d : String(n)))
    .join(';');

// Output formats that always produce one value; identical variants would only repeat entries
// (and a srcset may not list the same width twice), so they are dropped before formatting.
const SINGLE_VALUE_FORMATS = new Set(['srcset', 'img', 'picture']);

const matchers = new Map<string, (path: string) => boolean>();
const matcherFor = (globs: string[]) => {
  const key = JSON.stringify(globs);
  let match = matchers.get(key);
  if (!match) matchers.set(key, (match = picomatch(globs, { dot: true })));
  return match;
};

/**
 * Whether include/exclude let imagetools handle a file. Globs are matched against the path relative
 * to the Next.js app (the loader's root context), not Turbopack's root, which in a monorepo is the
 * workspace root — so `src/assets/**` means the same thing in either layout.
 */
function isHandled(relativePath: string, { include, exclude }: LoaderOptions): boolean {
  const file = relativePath.split(path.sep).join('/');
  if (include?.length && !matcherFor(include)(file)) return false;
  if (exclude?.length && matcherFor(exclude)(file)) return false;
  return true;
}

/**
 * The directives an import ends up with, lowest precedence first: `defaultDirectives`, then the
 * named preset, then the import's own query. Type-only markers (see client.d.ts) are dropped so a
 * marked import shares cache entries and output files with the same import unmarked.
 */
function resolveDirectives(query: URLSearchParams, options: LoaderOptions): URLSearchParams {
  for (const marker of TYPE_MARKERS) query.delete(marker);

  const presetName = query.get('preset');
  query.delete('preset');
  let preset: URLSearchParams | undefined;
  if (presetName !== null) {
    const definition = options.presets?.[presetName];
    if (definition === undefined) {
      const known = Object.keys(options.presets ?? {});
      throw new Error(
        `Unknown imagetools preset "${presetName}". ` +
          (known.length ? `Defined presets: ${known.join(', ')}.` : 'No presets are defined.'),
      );
    }
    preset = toParams(definition);
  }

  const directives = new URLSearchParams();
  for (const layer of [toParams(options.defaultDirectives), preset, query]) {
    for (const [key, value] of layer ?? []) directives.set(key, value);
  }
  return directives;
}

function uniqueByConfig(images: ProcessedImage[]): ProcessedImage[] {
  const seen = new Set<string>();
  return images.filter(image => {
    const key = JSON.stringify(image.config);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// loader-runner awaits a returned promise, so no this.async() is needed
export default async function imagetoolsLoader(this: LoaderContext): Promise<string> {
  const options = this.getOptions?.() ?? {};
  const pathname = this.resourcePath;

  // An import outside include/exclude is handed back to Next.js: re-importing the file without
  // its query reaches Next's own image handling, as if imagetools weren't installed.
  if (!isHandled(path.relative(this.rootContext ?? process.cwd(), pathname), options)) {
    return `export { default } from ${JSON.stringify(`./${path.basename(pathname)}`)};\n`;
  }

  const cacheDir = await prepareCache(this, options);
  const directives = resolveDirectives(new URLSearchParams(this.resourceQuery), options);

  const source = await readFile(pathname);
  const sourceHash = hash([source]);

  // clamp w/h to the intrinsic size unless allowUpscale
  if (directives.get('allowUpscale') !== 'true' && (directives.has('w') || directives.has('h'))) {
    const meta = await sharp(source).metadata();
    for (const [key, intrinsic] of [
      ['w', meta.width],
      ['h', meta.height],
    ] as const) {
      const before = directives.get(key);
      if (!before) continue;
      const after = clamp(before, intrinsic);
      directives.set(key, after);
      if (new Set(after.split(';')).size < new Set(before.split(';')).size) {
        this.emitWarning?.(
          new Error(
            `${path.basename(pathname)}: ${key}=${before} goes beyond the source's ${intrinsic}px, ` +
              `so some variants come out identical. Remove the extra values, or add ` +
              `allowUpscale=true to scale up.`,
          ),
        );
      }
    }
  }

  const configs = resolveConfigs(extractEntries(directives), builtinOutputFormats);
  const logger: Logger = {
    info: console.log,
    warn: m => this.emitWarning?.(new Error(m)),
    error: m => {
      throw new Error(m);
    },
  };

  const assetQueries: string[] = [];
  const outputs = await Promise.all(
    configs.map(async (config, i): Promise<ProcessedImage> => {
      const r = await processImage({
        source,
        sourceHash,
        config,
        searchParams: directives,
        cacheDir,
        logger,
        removeMetadata: options.removeMetadata !== false,
      });
      const ext = r.transforms.format === 'jpeg' ? 'jpg' : r.transforms.format;
      assetQueries[i] =
        `?${MARKER}=${sourceHash.slice(0, 12)}&${MARKER}_ext=${ext}&${new URLSearchParams(config)}`;
      return {
        src: PLACEHOLDER(i),
        image: sharp(r.data),
        config,
        info: {
          width: r.meta.width,
          height: r.meta.height,
          autoOriented: { width: r.meta.width, height: r.meta.height },
        },
        transforms: r.transforms,
        sharpMetadata: r.meta,
      };
    }),
  );

  const [as, args] = directives.get('as')?.split(':') ?? [];
  const outputFormat =
    (as && builtinOutputFormats[as as keyof typeof builtinOutputFormats]) || null;
  const format = outputFormat ? outputFormat(args ? args.split(';') : undefined) : urlFormat();
  const formatted = as && SINGLE_VALUE_FORMATS.has(as) ? uniqueByConfig(outputs) : outputs;
  const result = await format(formatted);

  // JSON is valid JS; splice each placeholder out of its string literal and
  // into a reference to the imported asset URL.
  const json = JSON.stringify(result).replaceAll(
    /__TPIT_(\d+)__/g,
    '" + __tpit_url(__tpit_$1) + "',
  );
  const self = `./${path.basename(pathname)}`;
  const imports = assetQueries
    .map((q, i) => `import __tpit_${i} from ${JSON.stringify(self + q)};`)
    .join('\n');

  const named = options.namedExports === false ? [] : namedExportKeys(result);
  const namedExports = named
    .map(key => `export const ${key} = __tpit_value[${JSON.stringify(key)}];`)
    .join('\n');

  return `${imports}
const __tpit_url = (m) => (m && typeof m === 'object' ? m.src : m);
const __tpit_value = ${json};
export default __tpit_value;
${namedExports}
`;
}

// Reserved words can't be export names; everything else that is a valid identifier can.
const RESERVED = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export ' +
    'extends false finally for function if implements import in instanceof interface let new ' +
    'null package private protected public return static super switch this throw true try ' +
    'typeof var void while with yield'
  ).split(' '),
);

/**
 * Keys of an object result (`as=metadata`, `as=img`, `as=picture`) to also export by name, so
 * `import { width, src } from './a.jpg?as=metadata'` works as it does in vite-imagetools. Arrays
 * and strings have no keys to export.
 */
function namedExportKeys(result: unknown): string[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  return Object.keys(result).filter(k => /^[A-Za-z_$][\w$]*$/.test(k) && !RESERVED.has(k));
}

// the source is read from disk by the loader itself, so skip the utf8 decode
export const raw = true;
