import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright', 'playwright-core'],
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@cli': path.resolve(__dirname, '../src'),
    };
    // CLI sources use Node ESM .js specifiers while the shared source is .ts.
    // Priority-matrix derivation is also bundled client-side.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.js'],
    };
    if (isServer) {
      // Externalize Playwright to avoid webpack bundling issues
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('playwright', 'playwright-core');
      }
    }
    return config;
  },
};

export default nextConfig;
