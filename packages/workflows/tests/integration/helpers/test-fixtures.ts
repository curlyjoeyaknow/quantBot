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
export function getClickHouseUrl(): string {
  // Use CLICKHOUSE_HTTP_PORT if set, otherwise CLICKHOUSE_PORT, otherwise default to 18123
  const port = process.env.CLICKHOUSE_HTTP_PORT || process.env.CLICKHOUSE_PORT || '18123';
  const host = process.env.CLICKHOUSE_HOST || 'localhost';
  return process.env.CLICKHOUSE_URL || `http://${host}:${port}`;
}

/**
 * Get test output directory
 */
export function getTestOutputDir(): string {
  return process.env.TEST_OUTPUT_DIR || '/tmp/quantbot_test_slices';
}
