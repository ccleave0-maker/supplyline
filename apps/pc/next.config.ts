import type { NextConfig } from 'next';
import pkg from './package.json' with { type: 'json' };

// Static export: the web app is plain files that talk to the versioned API.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@supplyline/core', '@supplyline/platform'],
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default config;
