import type { NextConfig } from 'next';
import { withImagetools } from 'turbopack-imagetools';

const nextConfig: NextConfig = {};

export default withImagetools(nextConfig);
