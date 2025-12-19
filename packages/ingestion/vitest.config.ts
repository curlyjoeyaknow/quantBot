import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Force inline these packages to use source files, not dist
    deps: {
      inline: [
        '@quantbot/simulation',
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
  esbuild: {
    target: 'node18',
  },
});

