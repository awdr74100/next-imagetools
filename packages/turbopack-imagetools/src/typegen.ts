// Exact types for imagetools imports. The shape of an import follows from its query and the
// options alone (see "Multiple variants" in the README), so a declaration can be generated per
// query — by the loader as it processes imports, and by the CLI before a build.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { builtinOutputFormats, extractEntries, resolveConfigs } from 'imagetools-core';

import { TYPE_MARKERS, dropEmptyValues } from './directives';

/** The options that change what an import returns. */
export interface TypegenOptions {
  defaultDirectives?: string | Record<string, string>;
  presets?: Record<string, string | Record<string, string>>;
  namedExports?: boolean;
}

const OUTPUT_FORMATS = new Set([...Object.keys(builtinOutputFormats), 'next']);

// Reserved words can't be export names; everything else that is a valid identifier can.
const RESERVED = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export ' +
    'extends false finally for function if implements import in instanceof interface let new ' +
    'null package private protected public return static super switch this throw true try ' +
    'typeof var void while with yield'
  ).split(' '),
);

/** Whether a result key can also be exported by name. */
export const isExportName = (key: string): boolean =>
  /^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key);

/**
 * The directives an import resolves to, as the loader resolves them (minus the config file's
 * `defaultDirectives` function, which needs the image). `undefined` for an unknown preset.
 */
function resolve(query: string, options: TypegenOptions) {
  const params = new URLSearchParams(query);
  for (const marker of TYPE_MARKERS) params.delete(marker);
  const presetName = params.get('preset');
  params.delete('preset');
  const preset = presetName === null ? undefined : options.presets?.[presetName];
  if (presetName !== null && preset === undefined) return undefined;

  const directives = new URLSearchParams();
  for (const layer of [options.defaultDirectives, preset, params]) {
    for (const [key, value] of new URLSearchParams(layer ?? '')) directives.set(key, value);
  }
  const placeholder = directives.has('placeholder');
  directives.delete('placeholder');
  directives.delete('inline');
  dropEmptyValues(directives);
  return { directives, placeholder };
}

/** How many images an import produces: the product of its value counts. */
export function imageCount(query: string, options: TypegenOptions = {}): number | undefined {
  const resolved = resolve(query, options);
  if (!resolved) return undefined;
  return resolveConfigs(extractEntries(resolved.directives), builtinOutputFormats).length;
}

const METADATA_KEYS = [
  'src',
  'width',
  'height',
  'format',
  'size',
  'space',
  'channels',
  'depth',
  'density',
  'isProgressive',
  'hasProfile',
  'hasAlpha',
  'orientation',
];

interface Shape {
  type: string;
  /** Keys to also export by name, for single-object results. */
  named: string[];
}

/** The TypeScript type of an import with this query, or `undefined` if it can't be known. */
export function shapeOf(query: string, options: TypegenOptions = {}): Shape | undefined {
  const resolved = resolve(query, options);
  if (!resolved) return undefined;
  const { directives, placeholder } = resolved;
  const count = resolveConfigs(extractEntries(directives), builtinOutputFormats).length;
  const [as = 'url', args] = (directives.get('as') ?? 'url').split(':');
  const withPlaceholder = (type: string) =>
    placeholder ? `${type} & { placeholder: string }` : type;
  const extra = placeholder ? ['placeholder'] : [];

  // a format from the config file: its result can't be known here
  if (!OUTPUT_FORMATS.has(as)) return { type: 'unknown', named: [] };

  switch (as) {
    case 'url':
      return { type: count === 1 ? 'string' : 'string[]', named: [] };
    case 'srcset':
      return { type: 'string', named: [] };
    case 'img':
      return {
        type: withPlaceholder('ImagetoolsImg'),
        named: ['src', 'w', 'h', 'srcset', ...extra],
      };
    case 'picture':
      return {
        type: withPlaceholder('ImagetoolsPicture'),
        named: ['sources', 'img', ...extra],
      };
    case 'next':
      return {
        type: withPlaceholder('ImagetoolsStaticImage'),
        named: ['src', 'width', 'height', 'blurDataURL', 'blurWidth', 'blurHeight', ...extra],
      };
    default: {
      // metadata / meta, optionally narrowed to some keys. imagetools-core leaves out keys the
      // metadata doesn't have, so a misspelled one is dropped from the type too, rather than
      // failing the whole project's type check.
      const keys = args?.split(';').filter(Boolean);
      const base = keys?.length
        ? `Pick<ImagetoolsMetadata, Extract<${keys.map(k => JSON.stringify(k)).join(' | ')}, keyof ImagetoolsMetadata>>`
        : 'ImagetoolsMetadata';
      if (count !== 1) return { type: `(${withPlaceholder(base)})[]`, named: [] };
      return {
        type: withPlaceholder(base),
        named: [...(keys?.filter(isExportName) ?? METADATA_KEYS), ...extra],
      };
    }
  }
}

/**
 * Module declarations for a query. The `.*` pattern has a one-character prefix, so for relative
 * imports it wins over the client types' `*` patterns whatever order they load in; the plain `*`
 * pattern covers path aliases.
 */
export function declarationsFor(
  query: string,
  options: TypegenOptions = {},
  clientTypes = 'turbopack-imagetools/client',
): string | undefined {
  // a `*` would be read as a second wildcard
  if (!query.startsWith('?') || query.includes('*')) return undefined;
  const shape = shapeOf(query, options);
  if (!shape) return undefined;
  const named =
    options.namedExports === false
      ? []
      : shape.named.map(key => `  export const ${key}: Field<${JSON.stringify(key)}>;`);
  const body = [
    '  type Value = ' + shape.type + ';',
    // a key the value doesn't have isn't exported at runtime either
    '  type Field<K extends string> = K extends keyof Value ? Value[K] : never;',
    '  const value: Value;',
    '  export default value;',
    ...named,
  ].join('\n');
  const modules = [`.*${query}`, `*${query}`].map(
    pattern => `declare module ${JSON.stringify(pattern)} {\n${body}\n}`,
  );
  const reference =
    clientTypes.startsWith('/') || /^[A-Za-z]:/.test(clientTypes)
      ? `/// <reference path=${JSON.stringify(clientTypes)} />`
      : `/// <reference types=${JSON.stringify(clientTypes)} />`;
  return `// Generated by turbopack-imagetools for imports ending in ${query}. Do not edit.\n${reference}\n\n${modules.join('\n\n')}\n`;
}

/** One file per query, named by its hash, so concurrent workers never write the same file twice. */
export const typesFileName = (query: string) =>
  `${createHash('sha1').update(query).digest('hex').slice(0, 16)}.d.ts`;

/** Writes a declaration file, leaving it untouched when it is already current. */
export function writeDeclaration(dir: string, query: string, content: string): string {
  const file = path.join(dir, typesFileName(query));
  let current: string | undefined;
  try {
    current = readFileSync(file, 'utf8');
  } catch {}
  if (current === content) return file;
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  } catch {
    // another worker wrote the same query's file at the same time; its content is identical
    rmSync(tmp, { force: true });
  }
  return file;
}
