import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/dist/**'],
    setupFiles: ['../../tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    // Force inline these packages to use source files, not dist
    deps: {
      inline: [
        '@quantbot/core',
        '@quantbot/utils',
        '@quantbot/storage',
        '@quantbot/backtest',
      ],
    },
    server: {
      deps: {
        // Inline @quantbot/backtest to avoid SSR module resolution issues with re-exported classes
        inline: ['@quantbot/backtest'],
      },
    },
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
      '@quantbot/backtest': path.resolve(__dirname, './src'),
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/storage': path.resolve(__dirname, '../storage/src'),
    },
  },
});

