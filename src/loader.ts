// imagetools loader for Turbopack.
//
// Turbopack has no emitFile, and files written mid-build are not visible to its resolver, so for
// every generated image the module imports the source again as `<file>?nit=…&<config>`. That
// import is matched by a rule with `type: 'asset'` whose loader (asset-loader.ts) returns the
// encoded bytes, and Turbopack's own asset pipeline hashes and emits them.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  builtinOutputFormats,
  extractEntries,
  resolveConfigs,
  urlFormat,
  type Logger,
  type OutputFormat,
  type ProcessedImage,
} from 'imagetools-core';
import picomatch from 'picomatch';
import sharp, { type Metadata } from 'sharp';

import { TYPE_MARKERS, checkDirectives, checkMarker, dropEmptyValues } from './directives';
import { largest, nextFormat, placeholderKind, placeholderOf } from './placeholder';
import {
  ANIMATED_FORMATS,
  isAnimated,
  MARKER,
  prepareCache,
  hash,
  loadConfig,
  processImage,
  toParams,
  warn,
  withContext,
  type LoaderContext,
  type LoaderOptions,
} from './shared';

const PLACEHOLDER = (i: number) => `__NIT_${i}__`;

// For data URLs; formats not listed fall back to `image/<format>`.
const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
};

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
const SINGLE_VALUE_FORMATS = new Set(['srcset', 'img', 'picture', 'next']);

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
 * The directives an import ends up with, lowest precedence first: the `defaultDirectives` option,
 * then the config file's `defaultDirectives` function, then the named preset, then the import's own
 * query. Type-only markers (see client.d.ts) are dropped so a marked import shares cache entries
 * and output files with the same import unmarked.
 */
function resolveDirectives(
  query: URLSearchParams,
  options: LoaderOptions,
  configDefaults: URLSearchParams | undefined,
): URLSearchParams {
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
  for (const layer of [toParams(options.defaultDirectives), configDefaults, preset, query]) {
    for (const [key, value] of layer ?? []) directives.set(key, value);
  }
  return directives;
}

/** Records the keys looked up through get/getAll/has. */
function trackReads(params: URLSearchParams, keys: Set<string>): void {
  for (const method of ['get', 'getAll', 'has'] as const) {
    const original = params[method].bind(params) as (key: string, value?: string) => unknown;
    Object.defineProperty(params, method, {
      value: (key: string, value?: string) => {
        keys.add(key);
        return original(key, value);
      },
    });
  }
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
export default function imagetoolsLoader(this: LoaderContext): Promise<string> {
  return withContext(this, () => load.call(this));
}

async function load(this: LoaderContext): Promise<string> {
  const options = this.getOptions?.() ?? {};
  const pathname = this.resourcePath;

  // An import outside include/exclude is handed back to Next.js: re-importing the file without
  // its query reaches Next's own image handling, as if imagetools weren't installed.
  if (!isHandled(path.relative(this.rootContext ?? process.cwd(), pathname), options)) {
    return `export { default } from ${JSON.stringify(`./${path.basename(pathname)}`)};\n`;
  }

  const cacheDir = await prepareCache(this, options);
  const { config: userConfig, factories, hash: configHash } = await loadConfig(this, options);
  const builtins: Record<string, OutputFormat> = { ...builtinOutputFormats, next: nextFormat };
  const outputFormats = userConfig.extendOutputFormats?.(builtins) ?? builtins;

  let configDefaults: URLSearchParams | undefined;
  // keys the config file's defaultDirectives reads, which makes custom ones (`?hero`) legitimate
  const consumed = new Set<string>();
  if (userConfig.defaultDirectives) {
    const url = pathToFileURL(pathname);
    url.search = this.resourceQuery;
    trackReads(url.searchParams, consumed);
    let metadata: Promise<Metadata> | undefined;
    configDefaults = await userConfig.defaultDirectives(
      url,
      () => (metadata ??= sharp(pathname).metadata()),
    );
  }
  const directives = resolveDirectives(
    new URLSearchParams(this.resourceQuery),
    options,
    configDefaults,
  );
  // `inline` changes how the image is delivered, not the image, so it stays out of the configs:
  // an inlined and a regular import of the same variant share one cache entry
  const inline = directives.has('inline');
  directives.delete('inline');
  // so does `placeholder`, which describes the processed image rather than changing it
  const placeholderValue = directives.get('placeholder');
  directives.delete('placeholder');
  const placeholder = placeholderValue === null ? undefined : placeholderKind(placeholderValue);

  dropEmptyValues(directives);
  const problems = checkDirectives(directives, outputFormats, consumed);
  for (const message of problems.warnings) warn(this, message);
  if (problems.errors.length) throw new Error(problems.errors.join(' '));

  const source = await readFile(pathname);
  const sourceHash = hash([source]);

  // clamp w/h to the intrinsic size unless allowUpscale
  const meta = await sharp(source).metadata();
  // A photo with an EXIF rotation (most phone portraits) stores its pixels sideways, and
  // imagetools-core turns it upright before resizing unless noAutoOrient is set — so clamp
  // against the size it will see, or a portrait's height is capped at its stored width.
  const upright = directives.has('noAutoOrient') ? meta : meta.autoOrient;
  if (directives.get('allowUpscale') !== 'true' && (directives.has('w') || directives.has('h'))) {
    for (const [key, intrinsic] of [
      ['w', upright.width],
      ['h', upright.height],
    ] as const) {
      const before = directives.get(key);
      if (!before) continue;
      const after = clamp(before, intrinsic);
      directives.set(key, after);
      if (new Set(after.split(';')).size < new Set(before.split(';')).size) {
        warn(
          this,
          `${key}=${before} goes beyond the source's ${intrinsic}px, so some variants come out ` +
            `identical. Remove the extra values, or add allowUpscale=true to scale up.`,
        );
      }
    }
  }

  const entries = extractEntries(directives);
  // An animated source converted to a format without frames keeps only the first one; say so,
  // rather than leaving a still image to be discovered in the browser.
  const frames = isAnimated(meta) ? (meta.pages ?? 1) : 1;
  if (frames > 1) {
    const stills = (directives.get('format') ?? meta.format ?? '')
      .split(';')
      .filter(format => format && !ANIMATED_FORMATS.has(format));
    if (stills.length) {
      warn(
        this,
        `the source has ${frames} frames, but ${stills.join(', ')} can't be animated, so only the ` +
          `first frame is kept. Use format=webp or format=gif to keep the animation.`,
      );
    }
  }
  const configs =
    userConfig.resolveConfigs?.(entries, outputFormats) ?? resolveConfigs(entries, outputFormats);
  const markerProblem = checkMarker(this.resourceQuery, directives.get('as'), configs.length);
  if (markerProblem) throw new Error(markerProblem);
  const logger: Logger = {
    info: console.log,
    warn: m => warn(this, m),
    error: m => {
      throw new Error(m);
    },
  };

  const assetQueries: (string | undefined)[] = [];
  const outputs = await Promise.all(
    configs.map(async (config, i): Promise<ProcessedImage> => {
      const r = await processImage({
        source,
        factories,
        configHash,
        sourceHash,
        config,
        searchParams: directives,
        cacheDir,
        logger,
        removeMetadata: options.removeMetadata !== false,
      });
      const ext = r.transforms.format === 'jpeg' ? 'jpg' : r.transforms.format;
      let src: string;
      if (inline) {
        src = `data:${MIME_TYPES[ext ?? ''] ?? `image/${ext}`};base64,${r.data.toString('base64')}`;
      } else {
        assetQueries[i] =
          `?${MARKER}=${sourceHash.slice(0, 12)}&${MARKER}_ext=${ext}&${new URLSearchParams(config)}`;
        src = PLACEHOLDER(i);
      }
      return {
        src,
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
  const outputFormat = (as && outputFormats[as]) || null;
  const format = outputFormat ? outputFormat(args ? args.split(';') : undefined) : urlFormat();
  const formatted = as && SINGLE_VALUE_FORMATS.has(as) ? uniqueByConfig(outputs) : outputs;
  const result = await format(formatted);

  if (placeholder) {
    // only an object has room for it: a URL or srcset string, or an array, would need a second
    // import anyway
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(
        'placeholder needs a single object result: use as=img, as=picture, as=metadata or ' +
          'as=next, with one image per format.',
      );
    }
    (result as Record<string, unknown>).placeholder = await placeholderOf(
      placeholder,
      largest(formatted),
    );
  }

  // JSON is valid JS; splice each placeholder out of its string literal and
  // into a reference to the imported asset URL.
  const json = JSON.stringify(result).replaceAll(/__NIT_(\d+)__/g, '" + __nit_url(__nit_$1) + "');
  const self = `./${path.basename(pathname)}`;
  // sparse when inlined: an inlined image has no asset to import
  const imports = assetQueries
    .map((q, i) => (q === undefined ? '' : `import __nit_${i} from ${JSON.stringify(self + q)};`))
    .filter(Boolean)
    .join('\n');

  const named = options.namedExports === false ? [] : namedExportKeys(result);
  const namedExports = named
    .map(key => `export const ${key} = __nit_value[${JSON.stringify(key)}];`)
    .join('\n');

  // Turbopack hands back the emitted path as is, so a source named `my photo.jpg` gives a URL
  // with a space in it — which splits a srcset entry in two. encodeURI escapes spaces and
  // non-ASCII characters and leaves the URL's structure (`https://`, `/`) alone.
  return `${imports}
const __nit_url = (m) => encodeURI(m && typeof m === 'object' ? m.src : m);
const __nit_value = ${json};
export default __nit_value;
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
