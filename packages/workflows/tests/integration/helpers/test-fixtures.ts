/**
 * Test fixtures for slice export integration tests
 */

/**
 * Deterministic runId generator for tests
 */
export function generateTestRunId(prefix = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Environment helpers
 */
export function getClickHouseUrl(): string {}

/**
 * Get test output directory
 */
export function getTestOutputDir(): string {
  return process.env.TEST_OUTPUT_DIR || '/tmp/quantbot_test_slices';
}
