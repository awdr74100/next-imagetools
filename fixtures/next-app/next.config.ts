import type { NextConfig } from 'next';
import { withImagetools } from 'turbopack-imagetools';

// TPIT_EXPORT=1 builds a static export; routes that need a server (*.dynamic.tsx) are left out
const isExport = process.env.TPIT_EXPORT === '1';

const nextConfig: NextConfig = {
  output: isExport ? 'export' : undefined,
  // export has no image optimization server; imagetools already did the work at build time
  images: isExport ? { unoptimized: true } : undefined,
  pageExtensions: isExport ? ['static.tsx'] : ['static.tsx', 'dynamic.tsx'],
};

export default withImagetools(nextConfig);
