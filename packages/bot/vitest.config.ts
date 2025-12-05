import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    globals: true,
    setupFiles: ['../../tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.test.ts'],
    },
  },
  resolve: {
    alias: {
      '@quantbot/bot': path.resolve(__dirname, './src'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/storage': path.resolve(__dirname, '../storage/src'),
      '@quantbot/services': path.resolve(__dirname, '../services/src'),
      '@quantbot/monitoring': path.resolve(__dirname, '../monitoring/src'),
      '@quantbot/simulation': path.resolve(__dirname, '../simulation/src'),
    },
  },
});

