import type { NextConfig } from 'next';
import { withImagetools } from 'turbopack-imagetools';

// The e2e suites build this app in several deployment shapes, picked by environment variables:
// - TPIT_EXPORT=1: a static export; routes that need a server (*.dynamic.tsx) are left out
// - TPIT_STANDALONE=1: `output: 'standalone'`
// - TPIT_BASE_PATH / TPIT_ASSET_PREFIX: served under a sub-path / with assets on another prefix
// - TPIT_NO_CACHE=1: imagetools' disk cache off, so every image is encoded again
const isExport = process.env.TPIT_EXPORT === '1';

const nextConfig: NextConfig = {
  output: isExport ? 'export' : process.env.TPIT_STANDALONE === '1' ? 'standalone' : undefined,
  basePath: process.env.TPIT_BASE_PATH || undefined,
  assetPrefix: process.env.TPIT_ASSET_PREFIX || undefined,
  // export has no image optimization server; imagetools already did the work at build time
  images: isExport ? { unoptimized: true } : undefined,
  pageExtensions: isExport ? ['static.tsx'] : ['static.tsx', 'dynamic.tsx'],
};

export default withImagetools(nextConfig, {
  presets: { thumb: 'w=120&format=webp' },
  // imports from here keep Next.js' own handling, query or not
  exclude: ['images/raw/**'],
  configFile: './imagetools.config.mjs',
  cache: { enabled: process.env.TPIT_NO_CACHE !== '1' },
});
