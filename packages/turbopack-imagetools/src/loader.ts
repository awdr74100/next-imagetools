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

// "300;9000" against a 1600px source → "300;1600"
const clamp = (s: string, n: number) =>
  [...new Set(s.split(';').map(d => (Number.parseInt(d) <= n ? d : String(n))))].join(';');

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

  // same as vite-imagetools: clamp w/h to the intrinsic size unless allowUpscale
  const w = directives.get('w');
  const h = directives.get('h');
  if (directives.get('allowUpscale') !== 'true' && (w || h)) {
    const meta = await sharp(source).metadata();
    if (w) directives.set('w', clamp(w, meta.width));
    if (h) directives.set('h', clamp(h, meta.height));
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
  const result = await format(outputs);

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
