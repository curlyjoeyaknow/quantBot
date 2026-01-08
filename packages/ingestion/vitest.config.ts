import { defineConfig } from 'vitest/config';
import path from 'path';
import type { Plugin } from 'vite';

// Plugin to force resolution to source files instead of dist
// This prevents "No exports main defined" errors by intercepting module resolution
const forceSourceResolution = (): Plugin => {
  return {
    name: 'force-source-resolution',
    enforce: 'pre',
    resolveId(id, importer) {
      // If trying to load a dist file, redirect to source
      if (id.includes('/dist/') && id.includes('@quantbot/')) {
        const distMatch = id.match(/@quantbot\/([^/]+)\/dist\/(.+)$/);
        if (distMatch) {
          const [, packageName, distPath] = distMatch;
          // Convert dist path to source path
          const sourcePath = path.resolve(__dirname, `../${packageName}/src/${distPath.replace(/\.js$/, '.ts')}`);
          try {
            const fs = require('fs');
            if (fs.existsSync(sourcePath)) {
              return sourcePath;
            }
          } catch {
            // Ignore
          }
        }
      }
      // If it's a @quantbot package import, force it to use source
      if (id.startsWith('@quantbot/')) {
        const packageName = id.replace('@quantbot/', '').split('/')[0];
        let subPath = id.replace(`@quantbot/${packageName}`, '') || '';
        if (subPath.startsWith('/')) {
          subPath = subPath.slice(1);
        }
        // Skip if it's already pointing to dist
        if (subPath.includes('/dist/')) {
          subPath = subPath.replace('/dist/', '/src/').replace(/\.js$/, '.ts');
        }
        if (subPath && !subPath.endsWith('.ts') && !subPath.endsWith('.js')) {
          subPath = `${subPath}.ts`;
        }
        if (!subPath) {
          subPath = 'index.ts';
        }
        const sourcePath = path.resolve(__dirname, `../${packageName}/src/${subPath}`);
        try {
          const fs = require('fs');
          if (fs.existsSync(sourcePath)) {
            return sourcePath;
          }
        } catch {
          // Ignore
        }
      }
      return null;
    },
    load(id) {
      // If trying to load a compiled JS file that uses CommonJS exports, prevent it
      if (id.includes('/dist/') && id.endsWith('.js') && id.includes('@quantbot/')) {
        // Try to find the source file instead
        const sourceId = id.replace('/dist/', '/src/').replace(/\.js$/, '.ts');
        try {
          const fs = require('fs');
          if (fs.existsSync(sourceId)) {
            // Return null to let Vite handle it, but the resolveId should have caught it
            return null;
          }
        } catch {
          // Ignore
        }
      }
      return null;
    },
  };
};

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Force inline these packages to use source files, not dist
    deps: {
      inline: [
        '@quantbot/backtest',
        '@quantbot/storage',
        '@quantbot/utils',
        '@quantbot/core',
        '@quantbot/api-clients',
        '@quantbot/ohlcv',
        '@quantbot/ingestion',
        '@quantbot/jobs',
      ],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@quantbot/ingestion': path.resolve(__dirname, './src'),
      '@quantbot/ingestion/*': path.resolve(__dirname, './src/*'),
      // Prevent loading dist files - always use source
      '^@quantbot/ingestion/dist/(.*)$': path.resolve(__dirname, './src/$1'),
      '@quantbot/ohlcv': path.resolve(__dirname, '../ohlcv/src'),
      '@quantbot/ohlcv/*': path.resolve(__dirname, '../ohlcv/src/*'),
      '@quantbot/storage': path.resolve(__dirname, '../storage/src'),
      '@quantbot/storage/*': path.resolve(__dirname, '../storage/src/*'),
      '@quantbot/api-clients': path.resolve(__dirname, '../api-clients/src'),
      '@quantbot/api-clients/*': path.resolve(__dirname, '../api-clients/src/*'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/utils/*': path.resolve(__dirname, '../utils/src/*'),
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
      '@quantbot/core/*': path.resolve(__dirname, '../core/src/*'),
      '@quantbot/jobs': path.resolve(__dirname, '../jobs/src'),
      '@quantbot/jobs/*': path.resolve(__dirname, '../jobs/src/*'),
    },
    // Ensure we don't resolve to dist files - prioritize source
    conditions: ['import', 'module', 'browser', 'default'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  plugins: [forceSourceResolution()],
  esbuild: {
    target: 'node18',
  },
});

