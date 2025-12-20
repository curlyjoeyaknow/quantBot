import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.integration.ts',
      'tests/properties/**/*.property.ts',
      'tests/fuzzing/**/*.fuzz.ts',
      'tests/golden/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'node_modules/**'],
      thresholds: {
        // api-clients: 85% lines, 85% functions, 80% branches (per .cursorrules-testing)
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@quantbot/api-clients': path.resolve(__dirname, './src'),
      '@quantbot/utils': path.resolve(__dirname, '../utils/src'),
      '@quantbot/core': path.resolve(__dirname, '../core/src'),
      '@quantbot/observability': path.resolve(__dirname, '../observability/src'),
    },
  },
  esbuild: {
    target: 'node18',
  },
});

