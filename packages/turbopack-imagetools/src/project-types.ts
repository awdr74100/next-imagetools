// Project-wide type generation behind `turbopack-imagetools typegen`: the declarations the
// loader writes during a build, written before there is one — for a CI that type-checks first.
// It reads the options from next.config through Next.js itself, finds image imports with
// TypeScript's own scanner, and prunes declarations no import needs any more.
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import picomatch from 'picomatch';

import type { LoaderOptions } from './shared';
import { declarationsFor, typesFileName, writeDeclaration } from './typegen';

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'out']);

type Rule = { loaders?: ({ loader?: string; options?: LoaderOptions } | string)[] };

interface Found {
  options: LoaderOptions;
  /** Source extensions withImagetools handles, from its rule keys (`*.jpg` → `jpg`). */
  extensions: Set<string>;
}

/** The module loader's options, as withImagetools put them into `turbopack.rules`. */
export function findImagetoolsOptions(rules: Record<string, unknown>): Found | undefined {
  let options: LoaderOptions | undefined;
  const extensions = new Set<string>();
  for (const [key, value] of Object.entries(rules)) {
    for (const rule of (Array.isArray(value) ? value : [value]) as Rule[]) {
      for (const loader of rule?.loaders ?? []) {
        if (typeof loader === 'object' && loader.loader === 'turbopack-imagetools/loader') {
          options ??= loader.options ?? {};
          extensions.add(key.replace(/^\*\./, ''));
        }
      }
    }
  }
  return options && { options, extensions };
}

/**
 * Walks the source files under `dir`.
 *
 * @yields Each import specifier with a query, with the file it appears in.
 */
export function* findImports(
  dir: string,
  ts: typeof import('typescript'),
  skip: Set<string>,
): Generator<{ file: string; specifier: string }> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name) && !skip.has(full)) {
        yield* findImports(full, ts, skip);
      }
    } else if (SOURCE_EXTENSIONS.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      const { importedFiles } = ts.preProcessFile(readFileSync(full, 'utf8'), true, true);
      for (const { fileName } of importedFiles) {
        if (fileName.includes('?')) yield { file: full, specifier: fileName };
      }
    }
  }
}

interface Generated {
  written: number;
  removed: number;
  typesDir: string;
}

/** `turbopack-imagetools typegen`: reads the options from the app's next.config. */
export async function typegen(dir: string): Promise<Generated> {
  const appRequire = createRequire(path.join(dir, 'package.json'));
  const nextConfigModule = await import(
    pathToFileURL(appRequire.resolve('next/dist/server/config')).href
  );
  const loadConfig = nextConfigModule.default?.default ?? nextConfigModule.default;
  const config = await loadConfig('phase-production-build', dir, { silent: true });

  const found = findImagetoolsOptions(config.turbopack?.rules ?? {});
  if (!found) {
    throw new Error(
      `next.config in ${dir} doesn't use withImagetools, so there is nothing to generate types for.`,
    );
  }
  if (!found.options.typesDir) {
    throw new Error('Generated types are off: pass `types: true` to withImagetools to use them.');
  }
  return writeProjectTypes(dir, found.options, found.extensions, config.distDir ?? '.next');
}

/**
 * Writes a declaration for every image import under `dir` and removes the ones no import needs.
 * Also runs after `next build` compiles, since the build empties `<distDir>/types` first and
 * Turbopack's cache can skip the loaders that would write them again.
 */
export function writeProjectTypes(
  dir: string,
  options: LoaderOptions,
  extensions: Set<string>,
  distDir: string,
): Generated {
  const ts = loadFrom<typeof import('typescript')>(
    createRequire(path.join(dir, 'package.json')),
    'typescript',
    'to find image imports',
  );
  const typesDir = path.resolve(dir, options.typesDir ?? '.next/types/turbopack-imagetools');
  const include = options.include?.length ? picomatch(options.include, { dot: true }) : undefined;
  const exclude = options.exclude?.length ? picomatch(options.exclude, { dot: true }) : undefined;

  const queries = new Set<string>();
  const skip = new Set([path.resolve(dir, distDir)]);
  for (const { file, specifier } of findImports(dir, ts, skip)) {
    const at = specifier.indexOf('?');
    const target = specifier.slice(0, at);
    const ext = path.extname(target).slice(1).toLowerCase();
    if (!extensions.has(ext)) continue;
    // include/exclude can only be checked for relative imports; an alias resolves elsewhere
    if (target.startsWith('.')) {
      const relative = path
        .relative(dir, path.resolve(path.dirname(file), target))
        .split(path.sep)
        .join('/');
      if ((include && !include(relative)) || exclude?.(relative)) continue;
    }
    queries.add(specifier.slice(at));
  }

  const kept = new Set<string>();
  for (const query of queries) {
    const declaration = declarationsFor(query, options);
    if (!declaration) continue;
    writeDeclaration(typesDir, query, declaration);
    kept.add(typesFileName(query));
  }
  let removed = 0;
  for (const name of safeReaddir(typesDir)) {
    if (/^[0-9a-f]{16}\.d\.ts$/.test(name) && !kept.has(name)) {
      rmSync(path.join(typesDir, name), { force: true });
      removed++;
    }
  }
  return { written: kept.size, removed, typesDir };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function loadFrom<T>(require: NodeJS.Require, name: string, why: string): T {
  try {
    return require(name) as T;
  } catch {
    throw new Error(`turbopack-imagetools needs ${name} installed in your app ${why}.`);
  }
}
