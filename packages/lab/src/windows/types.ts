/**
 * Rolling Window Types
 *
 * Types for rolling window execution and robustness testing.
 */

/**
 * Window configuration
 */
export interface WindowConfig {
  /**
   * Train window duration in seconds
   */
  trainDurationSeconds: number;

  /**
   * Test window duration in seconds
   */
  testDurationSeconds: number;

  /**
   * Step size for sliding (seconds)
   * If undefined, step = testDurationSeconds (no overlap)
   */
  stepSeconds?: number;
}

/**
 * Time window
 */
export interface TimeWindow {
  windowId: string;
  trainStart: number; // Unix timestamp (seconds)
  trainEnd: number;
  testStart: number;
  testEnd: number;
}

/**
 * Window execution result
 */
export interface WindowResult {
  windowId: string;
  trainMetrics?: unknown; // Metrics from train window
  testMetrics: unknown; // Metrics from test window
  success: boolean;
  error?: string;
}
