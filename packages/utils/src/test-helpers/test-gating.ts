/**
 * Test Gating Utilities
 *
 * Provides utilities to conditionally skip tests based on environment variables.
 * This allows tests to be categorized:
 * - Unit tests (run always, no external dependencies)
 * - Integration tests (may require RUN_DB_STRESS=1 for database tests)
 * - Stress tests (require specific flags: RUN_DB_STRESS, RUN_CHAOS_TESTS, etc.)
 *
 * Usage:
 * ```typescript
 * import { shouldRunDbStress, describe.skipIf } from '@quantbot/infra/utils/test-helpers/test-gating';
 *
 * describe.skipIf(!shouldRunDbStress())('Database Integration Tests', () => {
 *   // Tests that require real database connections
 * });
 * ```
 */

/**
 * Gate a test suite or test based on an environment variable
 *
 * @param envVar - Environment variable name to check
 * @param reason - Reason for skipping (shown in test output)
 * @returns true if test should run, false if it should be skipped
 */
export function shouldRunTest(envVar: string, _reason?: string): boolean {
  const value = process.env[envVar];
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Skip a test if the required environment variable is not set
 *
 * @param envVar - Environment variable name to check
 * @param reason - Reason for skipping (shown in test output)
 * @returns void (throws if env var not set, or returns if set)
 */
export function requireEnv(envVar: string, reason?: string): void {
  if (!shouldRunTest(envVar, reason)) {
    const message = reason ? `Test requires ${envVar}=1: ${reason}` : `Test requires ${envVar}=1`;
    throw new Error(message);
  }
}

/**
 * Test gate configuration
 */
export const TEST_GATES = {
  /**
   * Database stress tests (ClickHouse, DuckDB, Postgres)
   * Set RUN_DB_STRESS=1 to enable
   */
  DB_STRESS: 'RUN_DB_STRESS',

  /**
   * Chaos engineering tests (subprocess kills, resource exhaustion)
   * Set RUN_CHAOS_TESTS=1 to enable
   */
  CHAOS: 'RUN_CHAOS_TESTS',

  /**
   * Integration stress tests (require external services)
   * Set RUN_INTEGRATION_STRESS=1 to enable
   */
  INTEGRATION_STRESS: 'RUN_INTEGRATION_STRESS',
} as const;

/**
 * Helper to check if DB stress tests should run
 */
export function shouldRunDbStress(): boolean {
  return shouldRunTest(TEST_GATES.DB_STRESS);
}

/**
 * Helper to check if chaos tests should run
 */
export function shouldRunChaosTests(): boolean {
  return shouldRunTest(TEST_GATES.CHAOS);
}

/**
 * Helper to check if integration stress tests should run
 */
export function shouldRunIntegrationStress(): boolean {
  return shouldRunTest(TEST_GATES.INTEGRATION_STRESS);
}
