import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyTransforms,
  builtins,
  generateTransforms,
  type AppliedTransforms,
  type ImageConfig,
  type Logger,
  type TransformFactory,
} from 'imagetools-core';
import sharp, { type Metadata } from 'sharp';

import { version } from '../package.json';
import type { ImagetoolsConfig } from './config';

/** Options shared by both loaders; must stay JSON-serializable (Turbopack loader options). */
/** A set of directives, as a query string (`'w=400&format=webp'`) or an object. */
export type Directives = string | Record<string, string>;

// a type alias (not an interface) so it stays assignable to Next.js' JSON loader options
export type CacheOptions = {
  /** Cache processed images on disk between builds (default: true). */
  enabled?: boolean;
  /** Relative to the Next.js app (default: `node_modules/.cache/turbopack-imagetools`). */
  dir?: string;
  /** Remove entries that haven't been used for this many seconds (default: keep everything). */
  retention?: number;
};

export interface LoaderOptions {
  cache?: CacheOptions;
  removeMetadata?: boolean;
  /** Also export the keys of object results by name (default: true). */
  namedExports?: boolean;
  /** Applied to every import with a query, beneath the directives the import sets itself. */
  defaultDirectives?: Directives;
  /** Named directive sets, applied with `preset=<name>` in an import's query. */
  presets?: Record<string, Directives>;
  /**
   * Only handle imports whose path, relative to the Next.js app, matches one of these globs (e.g.
   * `src/assets/**`). Default: every path.
   */
  include?: string[];
  /** Never handle imports whose path, relative to the Next.js app, matches one of these globs. */
  exclude?: string[];
  /**
   * A module (relative to the Next.js app) whose default export holds the options that take
   * functions; see `ImagetoolsConfig` in `turbopack-imagetools/config`.
   */
  configFile?: string;
}

export const toParams = (directives: Directives | undefined): URLSearchParams | undefined =>
  directives === undefined ? undefined : new URLSearchParams(directives);

/** The subset of the webpack loader context that Turbopack provides and these loaders use. */
export interface LoaderContext {
  resourcePath: string;
  resourceQuery: string;
  rootContext?: string;
  getOptions?: () => LoaderOptions;
  emitWarning?: (warning: Error) => void;
  addDependency?: (file: string) => void;
}

/** Marks the internal per-image import that returns the encoded bytes. */
export const MARKER = 'tpit';
export const DEFAULT_CACHE_DIR = 'node_modules/.cache/turbopack-imagetools';

export function hash(parts: (string | Buffer)[]): string {
  const h = createHash('sha1');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

const sweeps = new Map<string, Promise<void>>();

/**
 * The cache directory to use, or `undefined` when caching is disabled. With `retention` set, the
 * first call in a process for a directory removes entries that haven't been used for that long;
 * loaders have no end-of-build hook, so this is the one point every worker passes through.
 */
export async function prepareCache(
  ctx: LoaderContext,
  options: LoaderOptions,
): Promise<string | undefined> {
  const { enabled = true, dir = DEFAULT_CACHE_DIR, retention } = options.cache ?? {};
  if (!enabled) return undefined;
  const resolved = path.resolve(ctx.rootContext ?? process.cwd(), dir);
  mkdirSync(resolved, { recursive: true });
  if (retention !== undefined) {
    let sweep = sweeps.get(resolved);
    if (!sweep) sweeps.set(resolved, (sweep = removeExpired(resolved, retention)));
    await sweep;
  }
  return resolved;
}

async function removeExpired(dir: string, retentionSeconds: number): Promise<void> {
  const cutoff = Date.now() - retentionSeconds * 1000;
  const names = await readdir(dir);
  await Promise.all(
    names.map(async name => {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => undefined);
      // entries are touched on every hit (see readCached), so mtime is the last use
      if (info?.isFile() && info.mtimeMs < cutoff) await rm(file, { force: true });
    }),
  );
}

/**
 * A cached encoding, or `undefined` to process the image again. Any read failure counts as a miss —
 * including an entry another worker's retention sweep removed a moment ago.
 */
async function readCached(file: string): Promise<Buffer | undefined> {
  try {
    const data = await readFile(file);
    if (data.length === 0) return undefined;
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
    return data;
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch {
    // another worker won the race (EPERM/EEXIST on Windows); its file is just as good
    await rm(tmp, { force: true });
  }
}

export interface ProcessedResult {
  id: string;
  data: Buffer;
  meta: Metadata;
  transforms: AppliedTransforms;
}

interface ProcessArgs {
  source: Buffer;
  /** Transform factories: the built-ins, or what the config file's extendTransforms returned. */
  factories: TransformFactory[];
  /** Hash of the config file, which can change the output; empty without one. */
  configHash: string;
  sourceHash: string;
  config: ImageConfig;
  searchParams: URLSearchParams;
  /** `undefined` when caching is disabled. */
  cacheDir: string | undefined;
  logger: Logger;
  removeMetadata: boolean;
}

const inflight = new Map<string, Promise<ProcessedResult>>();

/**
 * Everything besides the config and the source that decides the encoded bytes: this package
 * (transform behavior), and sharp with every codec it bundles (`sharp.versions` lists libvips,
 * mozjpeg, libwebp, aom, …). Upgrading any of them must not serve images encoded by the old one.
 */
export const ENGINE = JSON.stringify({ package: version, sharp: sharp.versions });

export function cacheKey(
  config: ImageConfig,
  sourceHash: string,
  removeMetadata: boolean,
  engine = ENGINE,
): string {
  return hash([JSON.stringify(config), sourceHash, String(removeMetadata), engine]);
}

/**
 * Runs one resolved config through imagetools-core, memoized in-process and on disk. Both the
 * module loader (needs dimensions) and the asset loader (needs bytes) call this. The cache key
 * covers the source, the config, the options that change the output and the engine versions, so
 * editing any of them never hits a stale entry.
 */
export function processImage(args: ProcessArgs): Promise<ProcessedResult> {
  const engine = args.configHash ? `${ENGINE}|config:${args.configHash}` : ENGINE;
  const id = cacheKey(args.config, args.sourceHash, args.removeMetadata, engine);
  let p = inflight.get(id);
  if (!p) {
    p = run(id, args);
    inflight.set(id, p);
    void p.finally(() => inflight.delete(id)).catch(() => {});
  }
  return p;
}

async function run(id: string, args: ProcessArgs): Promise<ProcessedResult> {
  const file = args.cacheDir === undefined ? undefined : path.join(args.cacheDir, id);
  let data = file === undefined ? undefined : await readCached(file);
  let transforms: AppliedTransforms = {};
  if (!data) {
    const { transforms: steps } = generateTransforms(
      args.config,
      args.factories,
      args.searchParams,
      args.logger,
    );
    const res = await applyTransforms(steps, sharp(args.source), args.removeMetadata);
    data = (await res.image.toBuffer({ resolveWithObject: true })).data;
    transforms = res.metadata.transforms;
    if (file !== undefined) await writeCache(file, data);
  }
  const meta = await sharp(data).metadata();
  const format = args.config['format'] ?? transforms.format ?? meta.format;
  if (format !== undefined) transforms.format = format;
  return { id, data, meta, transforms };
}

export interface LoadedConfig {
  config: ImagetoolsConfig;
  /** Content hash of the config file; empty when there is none. */
  hash: string;
  factories: TransformFactory[];
}

const NO_CONFIG: LoadedConfig = { config: {}, hash: '', factories: builtins };
const loadedConfigs = new Map<string, Promise<LoadedConfig>>();

/**
 * Imports the `configFile` module, if any. Three caches could otherwise serve an outdated config:
 *
 * - Turbopack, which reruns a loader only when its inputs change: the file is registered as a
 *   dependency of every module that uses it.
 * - Node's module cache, which returns the first import forever: the file is imported with its
 *   content hash in the URL, so an edit loads a new module.
 * - The disk cache: the hash is part of every cache key (see processImage).
 */
export async function loadConfig(
  ctx: LoaderContext,
  options: LoaderOptions,
): Promise<LoadedConfig> {
  if (!options.configFile) return NO_CONFIG;
  const file = path.resolve(ctx.rootContext ?? process.cwd(), options.configFile);
  ctx.addDependency?.(file);
  const content = await readFile(file).catch(() => {
    throw new Error(`turbopack-imagetools: configFile not found at ${file}`);
  });
  const contentHash = hash([content]);
  let loaded = loadedConfigs.get(contentHash);
  if (!loaded) {
    loaded = import(`${pathToFileURL(file).href}?v=${contentHash}`).then(
      (mod: { default?: ImagetoolsConfig }): LoadedConfig => {
        const config = mod.default ?? (mod as ImagetoolsConfig);
        return {
          config,
          hash: contentHash,
          factories: config.extendTransforms?.(builtins) ?? builtins,
        };
      },
    );
    loadedConfigs.set(contentHash, loaded);
  }
  return loaded;
}

/**
 * Runs a loader, prefixing any error with the file and query it was processing: in a large app,
 * "Expected positive integer for width" alone doesn't say which of hundreds of imports to fix.
 */
export async function withContext<T>(ctx: LoaderContext, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`turbopack-imagetools: ${where(ctx)}: ${message}`, { cause: error });
  }
}

/** The import being processed, as the user wrote it: app-relative path plus query. */
function where(ctx: LoaderContext): string {
  const file = path.relative(ctx.rootContext ?? process.cwd(), ctx.resourcePath);
  return `${file.split(path.sep).join('/')}${ctx.resourceQuery}`;
}

/**
 * Emits a build warning about the current import. Turbopack prints a warning's name and stack, so
 * the stack is replaced by the message: it's about the user's import, not our code.
 */
export function warn(ctx: LoaderContext, message: string): void {
  const warning = new Error(`${where(ctx)}: ${message}`);
  warning.name = 'turbopack-imagetools';
  warning.stack = `${warning.name}: ${warning.message}`;
  ctx.emitWarning?.(warning);
}
