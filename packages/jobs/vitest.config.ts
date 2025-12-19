import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'node_modules/**'],
    },
    deps: {
      inline: [
        '@quantbot/simulation',
        '@quantbot/storage',
        '@quantbot/utils',
        '@quantbot/core',
        '@quantbot/api-clients',
        '@quantbot/ingestion',
        '@quantbot/ohlcv',
      ],
    },
  },
  resolve: {
    alias: {
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/storage': path.resolve(__dirname, '../storage/src'),
      '@quantbot/api-clients': path.resolve(__dirname, '../api-clients/src'),
      '@quantbot/ohlcv': path.resolve(__dirname, '../ohlcv/src'),
      '@quantbot/ingestion': path.resolve(__dirname, '../ingestion/src'),
    },
  },
});

