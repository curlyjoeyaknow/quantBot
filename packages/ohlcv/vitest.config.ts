import { defineConfig } from 'vitest/config';
import path from 'path';
import type { Plugin } from 'vite';

// Plugin to force resolution to source files instead of dist
// This runs early in the resolution process to intercept before package.json exports
const forceSourceResolution = (): Plugin => {
  return {
    name: 'force-source-resolution',
    enforce: 'pre', // Run before other resolvers
    // Use load hook to intercept module loading
    load(id) {
      // If trying to load a dist file, load the source instead
      if (id.includes('@quantbot') && id.includes('dist')) {
        const match = id.match(/@quantbot\/([^/]+)/);
        if (match) {
          const packageName = match[1];
          let subPath = 'index.ts';
          if (id.includes('/candles') || id.endsWith('candles.js')) {
            subPath = 'candles.ts';
          } else if (id.includes('/dist/')) {
            const distMatch = id.match(/\/dist\/(.+?)\.js$/);
            if (distMatch) {
              subPath = `${distMatch[1]}.ts`;
            }
          }
          const sourcePath = path.resolve(__dirname, `../${packageName}/src/${subPath}`);
          try {
            const fs = require('fs');
            if (fs.existsSync(sourcePath)) {
              // Read and return the source file
              return fs.readFileSync(sourcePath, 'utf-8');
            }
          } catch {
            // Ignore
          }
        }
      }
      return null;
    },
    resolveId(id, importer) {
      // If it's a @quantbot package import, force it to use source
      if (id.startsWith('@quantbot/')) {
        const packageName = id.replace('@quantbot/', '').split('/')[0];
        let subPath = id.replace(`@quantbot/${packageName}`, '') || '';
        // Remove leading slash if present
        if (subPath.startsWith('/')) {
          subPath = subPath.slice(1);
        }
        // Handle /candles -> candles.ts
        if (subPath && !subPath.endsWith('.ts') && !subPath.endsWith('.js')) {
          subPath = `${subPath}.ts`;
        }
        // Resolve to source file
        const sourcePath = path.resolve(__dirname, `../${packageName}/src/${subPath}`);
        // Check if source file exists
        try {
          const fs = require('fs');
          if (fs.existsSync(sourcePath)) {
            // Return the absolute path to force Vitest to use it
            return sourcePath;
          }
        } catch {
          // If file doesn't exist, return null to let other resolvers handle it
        }
      }
      // Also intercept absolute paths to node_modules/dist that Vitest might resolve to
      // This handles cases where Vitest resolves through package.json exports to dist files
      if (id.includes('@quantbot') && (id.includes('dist') || id.includes('node_modules'))) {
        const match = id.match(/@quantbot\/([^/]+)/);
        if (match) {
          const packageName = match[1];
          // Extract the subpath - if it's /candles or candles.js, use candles.ts
          let subPath = 'index.ts';
          if (id.includes('/candles') || id.endsWith('candles.js')) {
            subPath = 'candles.ts';
          }
          const sourcePath = path.resolve(__dirname, `../${packageName}/src/${subPath}`);
          try {
            const fs = require('fs');
            if (fs.existsSync(sourcePath)) {
              // Return the source path to force Vitest to use it
              return sourcePath;
            }
          } catch {
            // Ignore
          }
        }
      }
      // Also handle absolute file paths that might be passed to resolveId
      // This catches paths like /home/memez/quantBot/packages/ohlcv/node_modules/@quantbot/simulation/dist/candles.js
      if (typeof id === 'string' && id.includes('@quantbot') && (id.includes('/dist/') || id.includes('node_modules'))) {
        // Extract package name from @quantbot/packageName part
        const quantbotMatch = id.match(/@quantbot\/([^/]+)/);
        if (quantbotMatch) {
          const packageName = quantbotMatch[1];
          let subPath = 'index.ts';
          if (id.includes('/candles') || id.endsWith('candles.js')) {
            subPath = 'candles.ts';
          } else if (id.includes('/dist/')) {
            // Extract subpath from dist path
            const distMatch = id.match(/\/dist\/(.+?)\.js$/);
            if (distMatch) {
              subPath = `${distMatch[1]}.ts`;
            }
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
      }
      return null;
    },
  };
};

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.integration.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/dist/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'node_modules/**'],
    },
    // Force inline these packages to use source files, not dist
    deps: {
      inline: [
        '@quantbot/simulation',
        '@quantbot/storage',
        '@quantbot/utils',
        '@quantbot/core',
        '@quantbot/api-clients',
      ],
    },
  },
  resolve: {
    alias: {
      // Force resolution to source files, not dist
      '@quantbot/ohlcv': path.resolve(__dirname, './src'),
      '@quantbot/storage': path.resolve(__dirname, '../storage/src'),
      '@quantbot/storage/*': path.resolve(__dirname, '../storage/src/*'),
      '@quantbot/api-clients': path.resolve(__dirname, '../api-clients/src'),
      '@quantbot/api-clients/*': path.resolve(__dirname, '../api-clients/src/*'),
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
      '@quantbot/core/*': path.resolve(__dirname, '../core/src/*'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/utils/*': path.resolve(__dirname, '../utils/src/*'),
      '@quantbot/simulation': path.resolve(__dirname, '../simulation/src'),
      '@quantbot/simulation/*': path.resolve(__dirname, '../simulation/src/*'),
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

