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
import sharp from 'sharp';

import { MARKER, cacheDirOf, hash, processImage, type LoaderContext } from './shared';

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
  const cacheDir = cacheDirOf(this, options);

  const pathname = this.resourcePath;
  const directives = new URLSearchParams(this.resourceQuery);
  // type-only markers (see client.d.ts); dropping them keeps cache keys and output files shared
  // with the same import written without a marker
  for (const marker of TYPE_MARKERS) directives.delete(marker);

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

  return `${imports}
const __tpit_url = (m) => (m && typeof m === 'object' ? m.src : m);
const __tpit_value = ${json};
export default __tpit_value;
`;
}

// the source is read from disk by the loader itself, so skip the utf8 decode
export const raw = true;
