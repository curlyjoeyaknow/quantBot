/**
 * Test Helper: Create Real WorkflowContext for Integration Tests
 *
 * Creates a real WorkflowContext with real ports and adapters.
 * Only mocks external APIs (Birdeye, Helius) if necessary.
 *
 * This enforces the ports pattern and tests actual integration boundaries.
 */

import { DateTime } from 'luxon';
import { createProductionContextWithPorts } from '../../src/context/createProductionContext.js';
import type { WorkflowContextWithPorts } from '../../src/context/workflowContextWithPorts.js';
// Use relative path for test helpers (they're not exported from the package)
import {
  createTestDuckDB,
  createTempDuckDBPath,
  cleanupTestDuckDB,
} from '../../../ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '../../../ingestion/tests/helpers/createTestDuckDB.js';

export interface TestContextOptions {
  /**
   * DuckDB path (defaults to temporary test database)
   */
  duckdbPath?: string;

  /**
   * Test calls to insert into DuckDB
   */
  testCalls?: TestCall[];

  /**
   * Mock external API calls (Birdeye, Helius)
   * Set to false to use real API calls (with rate limiting)
   */
  mockExternalApis?: boolean;

  /**
   * ClickHouse database name (defaults to test database)
   */
  clickHouseDatabase?: string;

  /**
   * Logger override (for test assertions)
   */
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };

  /**
   * Clock override (for deterministic testing)
   */
  clock?: {
    nowISO: () => string;
    now: () => DateTime;
  };
}

/**
 * Create a real WorkflowContext with real implementations
 *
 * This creates:
 * - Real DuckDB instance with test data
 * - Real ClickHouse connection (test database)
 * - Real ports with real adapters
 * - Real services (PythonEngine, DuckDBStorageService, etc.)
 *
 * Only external APIs (Birdeye, Helius) are mocked if `mockExternalApis` is true.
 */
export async function createTestWorkflowContext(options: TestContextOptions = {}): Promise<{
  context: WorkflowContextWithPorts;
  duckdbPath: string;
  cleanup: () => void;
}> {
  const {
    duckdbPath: providedPath,
    testCalls = [],
    mockExternalApis = true, // Default to mocking external APIs for speed
    logger,
    clock,
  } = options;

  // Create test DuckDB if path not provided
  const duckdbPath = providedPath || createTempDuckDBPath('test_workflow');
  const shouldCleanup = !providedPath; // Only cleanup if we created it

  // Cleanup function (defined before use)
  const cleanup = () => {
    if (shouldCleanup) {
      cleanupTestDuckDB(duckdbPath);
    }
  };

  // Create test DuckDB with test data
  if (testCalls.length > 0) {
    await createTestDuckDB(duckdbPath, testCalls);
  }

  // Create real production context with ports
  // Pass duckdbPath to createProductionPorts via environment variable temporarily
  // (createProductionPorts reads from process.env.DUCKDB_PATH)
  const originalDuckdbPath = process.env.DUCKDB_PATH;
  if (duckdbPath) {
    process.env.DUCKDB_PATH = duckdbPath;
  }

  try {
    const context = await createProductionContextWithPorts({
      logger,
      clock: clock
        ? {
            nowISO: clock.nowISO,
          }
        : undefined,
    });

    return {
      context,
      duckdbPath,
      cleanup,
    };
  } finally {
    // Restore original DUCKDB_PATH
    if (originalDuckdbPath !== undefined) {
      process.env.DUCKDB_PATH = originalDuckdbPath;
    } else {
      delete process.env.DUCKDB_PATH;
    }
  }
}

/**
 * Create a minimal test context for unit tests that need real implementations
 *
 * This is a lighter version that doesn't create DuckDB or ClickHouse connections.
 * Use this for tests that only need the context structure, not full integration.
 */
export async function createMinimalTestContext(
  options: TestContextOptions = {}
): Promise<WorkflowContextWithPorts> {
  const { logger, clock } = options;

  // Create production context with ports (async)
  const baseContext = await createProductionContextWithPorts({
    logger,
    clock: clock
      ? {
          nowISO: clock.nowISO,
        }
      : undefined,
  });

  // Return as WorkflowContextWithPorts (ports are added by createProductionContextWithPorts)
  return baseContext;
}
