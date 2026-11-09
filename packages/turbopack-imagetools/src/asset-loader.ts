// Returns the encoded bytes for one `?tpit=<hash>&<config>` import; the rule that uses this
// loader sets `type: 'asset'` so Turbopack emits it and exports a URL.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { MARKER, cacheDirOf, hash, processImage, type LoaderContext } from './shared';

// loader-runner awaits a returned promise, so no this.async() is needed
export default async function imagetoolsAssetLoader(this: LoaderContext): Promise<Buffer> {
  const options = this.getOptions?.() ?? {};
  const params = new URLSearchParams(this.resourceQuery);
  const ext = params.get(`${MARKER}_ext`);
  params.delete(MARKER);
  params.delete(`${MARKER}_ext`);
  const config = Object.fromEntries(params);

  // the rule's `as: '*.<ext>'` renames the module, which appends to resourcePath too
  let sourcePath = this.resourcePath;
  if (ext && sourcePath.endsWith(`.${ext}`) && !existsSync(sourcePath)) {
    sourcePath = sourcePath.slice(0, -ext.length - 1);
  }
  this.addDependency?.(sourcePath);

  const source = await readFile(sourcePath);
  const r = await processImage({
    source,
    sourceHash: hash([source]),
    config,
    searchParams: params,
    cacheDir: cacheDirOf(this, options),
    logger: console,
    removeMetadata: options.removeMetadata !== false,
  });
  return r.data;
}

// the source is read from disk by the loader itself, so skip the utf8 decode
export const raw = true;
