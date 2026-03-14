import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright', 'playwright-core'],
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  webpack: (config, { isServer }) => {
    if (isServer) {
      // The CLI code uses .js extensions in imports (Node.js ESM convention)
      // but sources are .ts files. Tell webpack to also try .ts when resolving .js
      config.resolve = config.resolve || {};
      config.resolve.extensionAlias = {
        '.js': ['.ts', '.js'],
      };
      // Allow importing from parent src/ directory
      config.resolve.alias = {
        ...config.resolve.alias,
        '@cli': path.resolve(__dirname, '../src'),
      };
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
