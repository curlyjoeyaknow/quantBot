import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.integration.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@quantbot/ohlcv': path.resolve(__dirname, './src'),
      '@quantbot/storage': path.resolve(__dirname, '../storage/src'),
      '@quantbot/api-clients': path.resolve(__dirname, '../api-clients/src'),
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
    },
  },
  esbuild: {
    target: 'node18',
  },
});

