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
});

