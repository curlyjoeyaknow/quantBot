/**
 * Vitest configuration for stress tests
 *
 * Stress tests are separate from unit/integration tests because they:
 * - May take longer to run
 * - Test edge cases and failure modes
 * - Simulate adversarial conditions
 * - Are optional but recommended before releases
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

