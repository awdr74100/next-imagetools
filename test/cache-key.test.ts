// The cache key decides whether an encoded image on disk can be reused. A key that ignores an
// input serves stale images, so every input that changes the output must change the key. Tested
// against the source module, since the key function isn't part of the built package's API.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { version } from '../packages/turbopack-imagetools/package.json';
import { ENGINE, cacheKey } from '../packages/turbopack-imagetools/src/shared';

const config = { w: '400', format: 'webp' };
const base = cacheKey(config, 'source', true);

describe('cache key', () => {
  it('is stable for the same inputs', () => {
    expect(cacheKey({ ...config }, 'source', true)).toBe(base);
  });

  it.each([
    ['the config', () => cacheKey({ ...config, w: '401' }, 'source', true)],
    ['the source', () => cacheKey(config, 'edited source', true)],
    ['removeMetadata', () => cacheKey(config, 'source', false)],
    ['the engine', () => cacheKey(config, 'source', true, `${ENGINE}+upgraded`)],
  ])('changes with %s', (_, key) => {
    expect(key()).not.toBe(base);
  });

  it('pins the engine to this package, sharp and every bundled codec', () => {
    const engine = JSON.parse(ENGINE) as { package: string; sharp: Record<string, string> };
    expect(engine.package).toBe(version);
    expect(engine.sharp).toEqual(sharp.versions);
    for (const lib of ['sharp', 'vips', 'webp', 'aom', 'mozjpeg'])
      expect(engine.sharp).toHaveProperty(lib);
  });
});
