import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // both suites mutate .next, the cache and the fixture image
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
