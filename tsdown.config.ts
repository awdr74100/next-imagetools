import { defineConfig } from 'tsdown';

export default defineConfig([
  // `withImagetools()` is imported from next.config.{ts,mjs,js}, and `config` / `core` from
  // config files in either module system, so they ship both formats.
  {
    entry: { index: 'src/index.ts', config: 'src/config.ts', core: 'src/core.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node22',
    dts: true,
    clean: true,
    fixedExtension: true,
    publint: true,
  },
  // Turbopack and webpack load loaders by path through loader-runner, which reads `default`,
  // `raw` and `pitch` off a CommonJS module. Both entries share one build so `shared.ts` (and its
  // in-process memo of running transforms) is a single chunk rather than a copy per loader.
  {
    entry: { loader: 'src/loader.ts', 'asset-loader': 'src/asset-loader.ts' },
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    fixedExtension: true,
  },
]);
