/**
 * Vitest configuration for stress tests
 *
 * Stress tests are separate from unit/integration tests because they:
 * - May take longer to run
 * - Test edge cases and failure modes
 * - Simulate adversarial conditions
 * - Are optional but recommended before releases
 *
 * ## Environment Variables for Test Gating
 *
 * By default, stress tests run offline (no external services required).
 * Some test categories are gated behind environment variables:
 *
 * - `RUN_DB_STRESS=1` - Enable database stress tests (ClickHouse, DuckDB, Postgres)
 * - `RUN_CHAOS_TESTS=1` - Enable chaos engineering tests (subprocess kills, resource exhaustion)
 * - `RUN_INTEGRATION_STRESS=1` - Enable integration stress tests (require external services)
 *
 * Example:
 * ```bash
 * # Run all offline stress tests
 * pnpm test:stress
 *
 * # Run with database tests
 * RUN_DB_STRESS=1 pnpm test:stress
 *
 * # Run with chaos tests
 * RUN_CHAOS_TESTS=1 pnpm test:stress
 *
 * # Run everything
 * RUN_DB_STRESS=1 RUN_CHAOS_TESTS=1 RUN_INTEGRATION_STRESS=1 pnpm test:stress
 * ```
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: 'stress',
    include: [
      'packages/**/tests/stress/**/*.stress.test.ts',
      'packages/**/tests/stress/**/*.stress.test.js',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
    ],
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds (stress tests may be slower)
    hookTimeout: 10000,
    teardownTimeout: 10000,
    isolate: true,
    threads: true,
    maxThreads: 4,
    minThreads: 1,
    reporters: ['verbose'],
    coverage: {
      enabled: false, // Stress tests don't contribute to coverage
    },
  },
  resolve: {
    alias: {
      '@quantbot/ingestion': path.resolve(__dirname, './packages/ingestion/src'),
      '@quantbot/ohlcv': path.resolve(__dirname, './packages/ohlcv/src'),
      '@quantbot/storage': path.resolve(__dirname, './packages/storage/src'),
      '@quantbot/api-clients': path.resolve(__dirname, './packages/api-clients/src'),
      '@quantbot/utils': path.resolve(__dirname, './packages/utils/src'),
      '@quantbot/core': path.resolve(__dirname, './packages/core/src'),
      '@quantbot/analytics': path.resolve(__dirname, './packages/analytics/src'),
      '@quantbot/backtest': path.resolve(__dirname, './packages/simulation/src'),
      '@quantbot/workflows': path.resolve(__dirname, './packages/workflows/src'),
    },
    dedupe: ['@quantbot/core', '@quantbot/utils', '@quantbot/storage'],
  },
  optimizeDeps: {
    exclude: ['@quantbot/core', '@quantbot/utils', '@quantbot/storage', '@quantbot/ingestion'],
  },
  esbuild: {
    target: 'node18',
  },
});

