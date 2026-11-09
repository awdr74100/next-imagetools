import { defineConfig } from 'vitest/config';

/**
 * Two projects, run together by `pnpm test` or alone with `--project`:
 *
 * - `unit` calls the built loaders and `withImagetools()` directly. Seconds, no Next.js.
 * - `e2e` builds, serves and browses the fixture app and the playground with real Next.js and
 *   Chromium. Minutes, and a fair amount of memory.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          // the suites share the fixture's .next, its image cache and its source image
          fileParallelism: false,
          testTimeout: 300_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
