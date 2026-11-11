// The directive checks are pure functions, tested against the source module. What the loaders do
// with their results (warnings, errors with context) is covered in loader.test.ts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { builtinOutputFormats } from 'imagetools-core';
import { describe, expect, it } from 'vitest';

import {
  KNOWN_DIRECTIVES,
  checkDirectives,
  closest,
  dropEmptyValues,
} from '../packages/turbopack-imagetools/src/directives';

const check = (
  query: string,
  consumed?: Set<string>,
  formats: Record<string, unknown> = builtinOutputFormats,
) => checkDirectives(new URLSearchParams(query), formats, consumed);

describe('KNOWN_DIRECTIVES', () => {
  // Guards the list against an imagetools-core upgrade renaming or dropping a directive. Names
  // this package adds or that only appear as position values are checked elsewhere.
  it('only lists names imagetools-core actually reads', () => {
    const core = readFileSync(createRequire(import.meta.url).resolve('imagetools-core'), 'utf8');
    const notInCore = [...KNOWN_DIRECTIVES].filter(
      name => name !== 'as' && !name.includes(' ') && !new RegExp(`\\b${name}\\b`).test(core),
    );
    expect(notInCore).toEqual([]);
  });
});

describe('checkDirectives', () => {
  it('accepts known directives with valid values', () => {
    expect(
      check(
        'w=300;600&h=200&format=webp&quality=80&fit=cover&position=top&blur&rotate=-90&as=srcset',
      ),
    ).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    ['widht', 'w'],
    ['heigth', 'h'],
    ['width', 'w'],
    ['qualty', 'quality'],
    ['grayscal', 'grayscale'],
    ['withoutEnlargement', 'allowUpscale (images are never enlarged unless it is set)'],
  ])('warns about %s and suggests %s', (key, suggestion) => {
    expect(check(`${key}=1`).warnings).toEqual([
      `Unknown directive "${key}" has no effect. Did you mean ${suggestion}?`,
    ]);
  });

  it('warns without a suggestion when nothing is close', () => {
    expect(check('zzzzzz=1').warnings).toEqual(['Unknown directive "zzzzzz" has no effect.']);
  });

  it('does not flag keys the config file consumed, or custom output format names', () => {
    expect(check('hero', new Set(['hero'])).warnings).toEqual([]);
    expect(check('as=dims', undefined, { ...builtinOutputFormats, dims: () => () => [] })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it.each([
    ['w=abc', 'w=abc is not valid: w takes a positive integer.'],
    ['w=300;0', 'w=0 is not valid: w takes a positive integer.'],
    ['h=-1', 'h=-1 is not valid: h takes a positive integer.'],
    ['w=12.5', 'w=12.5 is not valid: w takes a positive integer.'],
    ['quality=0', 'quality=0 is not valid: quality takes an integer from 1 to 100.'],
    ['quality=101', 'quality=101 is not valid: quality takes an integer from 1 to 100.'],
    ['rotate=a', 'rotate=a is not valid: rotate takes an integer (degrees).'],
    ['blur=x', 'blur=x is not valid: blur takes a number, or no value.'],
    ['effort=high', 'effort=high is not valid: effort takes an integer, "min" or "max".'],
    ['aspect=wide', 'aspect=wide is not valid: aspect takes a number or a ratio like 16:9.'],
    [
      'format=jxl',
      'format=jxl is not valid: format takes one of jpg, jpeg, png, webp, avif, gif, tiff, heif.',
    ],
  ])('rejects %s', (query, error) => {
    expect(check(query).errors).toEqual([error]);
  });

  it.each([
    'blur',
    'blur=true',
    'blur=2.5',
    'effort=max',
    'aspect=16:9',
    'aspect=1.5',
    'rotate=-90',
  ])('accepts %s', query => {
    expect(check(query).errors).toEqual([]);
  });

  it('rejects an unknown output format, suggesting the closest', () => {
    expect(check('as=piture').errors).toEqual([
      'Unknown output format as=piture. Did you mean as=picture? Available: url, srcset, img, picture, metadata, meta.',
    ]);
    expect(check('as=metadata:width;height').errors).toEqual([]);
  });
});

describe('dropEmptyValues', () => {
  it.each([
    ['format=webp;', 'format=webp'],
    ['w=;300;;600;', 'w=300%3B600'],
    ['w=300', 'w=300'],
  ])('%s → %s', (input, output) => {
    const params = new URLSearchParams(input);
    dropEmptyValues(params);
    expect(params.toString()).toBe(output);
  });
});

describe('closest', () => {
  it('finds a near miss, and nothing for a far one', () => {
    expect(closest('pictur', ['picture', 'srcset'])).toBe('picture');
    expect(closest('xyz', ['picture', 'srcset'])).toBeUndefined();
  });

  it('counts a swap of adjacent letters as one edit', () => {
    expect(closest('scrset', ['srcset', 'picture'])).toBe('srcset');
  });
});
