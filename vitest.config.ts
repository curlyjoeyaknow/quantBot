import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const projectRoot = path.dirname(fileURLToPath(new URL(import.meta.url)));
const resolveFromRoot = (p: string) => path.join(projectRoot, p);

export default defineConfig({
  test: {
    // Only test packages (new architecture)
    // Exclude stress tests (they have their own config)
    include: [
      'packages/**/tests/unit/**/*.test.ts',
      'packages/**/tests/unit/**/*.spec.ts',
      'packages/**/tests/integration/**/*.test.ts',
      'packages/**/tests/integration/**/*.spec.ts',
      'packages/**/tests/properties/**/*.test.ts',
      'packages/**/tests/properties/**/*.spec.ts',
      'packages/**/tests/fuzzing/**/*.test.ts',
      'packages/**/tests/fuzzing/**/*.spec.ts',
      'packages/**/tests/e2e/**/*.test.ts',
      'packages/**/tests/e2e/**/*.spec.ts',
      // Legacy: tests at package root (migrate to tests/unit)
      'packages/**/*.test.ts',
      'packages/**/*.spec.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      '**/node_modules/**',
      '**/dist/**',
      // Exclude stress tests (they have their own config)
      '**/tests/stress/**',
      '**/*.stress.test.ts',
      '**/*.stress.test.js',
    ],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 5000,
    // Ensure aliases take precedence over node_modules resolution
    deps: {
      inline: ['@quantbot/simulation', '@quantbot/monitoring', '@quantbot/ingestion'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/**/src/**/*.ts'],
      exclude: [
        'packages/**/src/**/*.d.ts',
        'packages/**/src/**/index.ts',
        'packages/**/dist/**',
        'packages/**/node_modules/**',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@quantbot/api-clients': resolveFromRoot('packages/api-clients/src'),
      '@quantbot/api-clients/*': resolveFromRoot('packages/api-clients/src/*'),
      '@quantbot/utils': resolveFromRoot('packages/utils/src'),
      '@quantbot/utils/*': resolveFromRoot('packages/utils/src/*'),
      '@quantbot/storage': resolveFromRoot('packages/storage/src'),
      '@quantbot/storage/*': resolveFromRoot('packages/storage/src/*'),
      '@quantbot/monitoring': resolveFromRoot('packages/monitoring/src'),
      '@quantbot/monitoring/*': resolveFromRoot('packages/monitoring/src/*'),
      '@quantbot/simulation': resolveFromRoot('packages/simulation/src'),
      '@quantbot/simulation/*': resolveFromRoot('packages/simulation/src/*'),
      '@quantbot/ohlcv': resolveFromRoot('packages/ohlcv/src'),
      '@quantbot/ohlcv/*': resolveFromRoot('packages/ohlcv/src/*'),
      '@quantbot/ingestion': resolveFromRoot('packages/ingestion/src'),
      '@quantbot/ingestion/*': resolveFromRoot('packages/ingestion/src/*'),
      '@quantbot/analytics': resolveFromRoot('packages/analytics/src'),
      '@quantbot/analytics/*': resolveFromRoot('packages/analytics/src/*'),
      '@quantbot/data': resolveFromRoot('packages/data/src'),
      '@quantbot/data/*': resolveFromRoot('packages/data/src/*'),
    },
  },
  optimizeDeps: {
    include: ['@quantbot/simulation', '@quantbot/monitoring', '@quantbot/ingestion'],
    exclude: [],
  },
});
