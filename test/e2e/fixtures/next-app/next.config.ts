import type { NextConfig } from 'next';
import { withImagetools } from 'next-imagetools';

// The e2e suites build this app in several deployment shapes, picked by environment variables:
// - NIT_EXPORT=1: a static export; routes that need a server (*.dynamic.tsx) are left out
// - NIT_STANDALONE=1: `output: 'standalone'`
// - NIT_BASE_PATH / NIT_ASSET_PREFIX: served under a sub-path / with assets on another prefix
// - NIT_NO_CACHE=1: imagetools' disk cache off, so every image is encoded again
const isExport = process.env.NIT_EXPORT === '1';

const nextConfig: NextConfig = {
  output: isExport ? 'export' : process.env.NIT_STANDALONE === '1' ? 'standalone' : undefined,
  basePath: process.env.NIT_BASE_PATH || undefined,
  assetPrefix: process.env.NIT_ASSET_PREFIX || undefined,
  // export has no image optimization server; imagetools already did the work at build time
  images: isExport ? { unoptimized: true } : undefined,
  pageExtensions: isExport ? ['static.tsx'] : ['static.tsx', 'dynamic.tsx'],
};

export default withImagetools(nextConfig, {
  presets: { thumb: 'w=120&format=webp' },
  // imports from here keep Next.js' own handling, query or not
  exclude: ['images/raw/**'],
  configFile: './imagetools.config.mjs',
  cache: { enabled: process.env.NIT_NO_CACHE !== '1' },
});
