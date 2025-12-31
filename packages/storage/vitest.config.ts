import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/properties/**/*.property.ts',
      'tests/integration/**/*.integration.ts',
      'tests/fuzzing/**/*.fuzz.ts',
      'tests/golden/**/*.test.ts',
      'tests/security/**/*.test.ts',
      'tests/performance/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@quantbot/storage': path.resolve(__dirname, './src'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
    },
  },
});

