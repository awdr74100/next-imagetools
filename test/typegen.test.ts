// Generated declarations, checked two ways: the text for each shape, and — what matters — that
// TypeScript, compiling imports against them, infers exactly the shape the loader returns.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import {
  declarationsFor,
  imageCount,
  shapeOf,
  typesFileName,
} from '../packages/turbopack-imagetools/src/typegen';

const CLIENT = path.resolve(import.meta.dirname, '../packages/turbopack-imagetools/client.d.ts');
const options = {
  presets: { thumb: 'w=100;200&format=webp' },
};

describe('imageCount and shapeOf', () => {
  it.each([
    ['?w=400&format=webp', 1, 'string'],
    ['?w=400;800&format=webp', 2, 'string[]'],
    ['?w=400&format=avif;webp', 2, 'string[]'],
    ['?w=400;800&format=webp&as=srcset', 2, 'string'],
    ['?w=400;800&format=avif;webp&as=picture', 4, 'ImagetoolsPicture'],
    ['?w=400&format=webp&as=metadata', 1, 'ImagetoolsMetadata'],
    ['?w=400;800&as=metadata', 2, '(ImagetoolsMetadata)[]'],
    ['?w=400&as=metadata:width;height', 1, 'Pick<ImagetoolsMetadata, "width" | "height">'],
    ['?w=400&placeholder&as=img', 1, 'ImagetoolsImg & { placeholder: string }'],
    ['?w=400;800&format=webp&as=next', 2, 'ImagetoolsStaticImage'],
    ['?w=400&format=webp;', 1, 'string'],
    ['?w=400&format=webp&inline&imagetools', 1, 'string'],
    ['?preset=thumb', 2, 'string[]'],
    ['?w=400&as=dims', 1, 'unknown'],
  ])('%s → %i image(s), %s', (query, count, type) => {
    expect(imageCount(query, options)).toBe(count);
    expect(shapeOf(query, options)?.type).toBe(type);
  });

  it('counts defaultDirectives in', () => {
    expect(shapeOf('?w=400', { defaultDirectives: 'format=avif;webp' })?.type).toBe('string[]');
  });

  it('knows nothing about an unknown preset, or a query with a second wildcard', () => {
    expect(shapeOf('?preset=nope', options)).toBeUndefined();
    expect(declarationsFor('?w=400&tint=*', options)).toBeUndefined();
  });

  it('names one file per query', () => {
    expect(typesFileName('?w=400')).toMatch(/^[0-9a-f]{16}\.d\.ts$/);
    expect(typesFileName('?w=400')).not.toBe(typesFileName('?w=401'));
  });

  it('leaves named exports out when namedExports is false', () => {
    const declaration = declarationsFor('?w=400&as=metadata', { namedExports: false });
    expect(declaration).not.toMatch(/export const/);
  });
});

describe('the generated declarations, compiled', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpit-typegen-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const queries = [
    '?w=400&format=webp',
    '?w=400;800&format=webp',
    '?w=400;800&format=webp&as=srcset',
    '?w=400&format=webp&as=metadata',
    '?w=400;800&format=webp&as=metadata',
    '?w=400&as=metadata:width;height',
    '?w=400&placeholder&as=img',
    '?w=400&format=webp&as=img',
    '?w=400;800&format=avif;webp&as=picture',
    '?w=400;800&format=webp&as=next',
    '?preset=thumb',
    '?w=400&as=dims',
  ];

  const usage = `
import url from './images/hero.jpg?w=400&format=webp';
import urls from '../images/hero.jpg?w=400;800&format=webp';
import srcset from './hero.jpg?w=400;800&format=webp&as=srcset';
import meta, { width } from './hero.jpg?w=400&format=webp&as=metadata';
import metas from './hero.jpg?w=400;800&format=webp&as=metadata';
import picked from './hero.jpg?w=400&as=metadata:width;height';
import withPlaceholder, { placeholder } from './hero.jpg?w=400&placeholder&as=img';
import img from './hero.jpg?w=400&format=webp&as=img';
import picture from './hero.jpg?w=400;800&format=avif;webp&as=picture';
import next from './hero.jpg?w=400;800&format=webp&as=next';
import thumbs from './hero.jpg?preset=thumb';
import aliased from '@/hero.jpg?w=400;800&format=webp';
import custom from './hero.jpg?w=400&as=dims';

url satisfies string;
urls satisfies string[];
aliased satisfies string[];
srcset satisfies string;
meta satisfies { src: string; width: number; height: number; format: string };
width satisfies number;
metas satisfies { width: number }[];
picked satisfies { width: number; height: number };
withPlaceholder satisfies { src: string; w: number; placeholder: string };
placeholder satisfies string;
img satisfies { src: string; w: number; h: number };
picture satisfies { sources: Record<string, string>; img: { src: string } };
next satisfies { src: string; width: number; height: number; blurDataURL: string };
thumbs satisfies string[];
custom satisfies unknown;

// @ts-expect-error one image is not an array
url satisfies string[];
// @ts-expect-error two images are not one string
urls satisfies string;
// @ts-expect-error several images give an array of metadata
metas.width;
// @ts-expect-error narrowed metadata has no format
picked.format;
// @ts-expect-error no placeholder without the directive
img.placeholder;
// @ts-expect-error a custom format's result is unknown, not any
custom.anything;
`;

  it('make TypeScript infer exactly what the loader returns', () => {
    // a broader declaration loaded first, like the client types: the generated ones must still win
    writeFileSync(
      path.join(dir, '0-generic.d.ts'),
      `declare module '*as=metadata' { const v: { generic: true }; export default v; }\n`,
    );
    const files = [path.join(dir, '0-generic.d.ts')];
    for (const query of queries) {
      const file = path.join(dir, typesFileName(query));
      writeFileSync(file, declarationsFor(query, options, CLIENT)!);
      files.push(file);
    }
    writeFileSync(path.join(dir, 'usage.ts'), usage);
    files.push(path.join(dir, 'usage.ts'));

    const program = ts.createProgram(files, {
      strict: true,
      noEmit: true,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map(
        d =>
          `${d.file ? path.basename(d.file.fileName) : ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      );
    expect(diagnostics).toEqual([]);
  });
});
