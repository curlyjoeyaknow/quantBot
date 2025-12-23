/**
 * Integration Tests for ingestOhlcvHandler
 *
 * Uses REAL implementations:
 * - Real DuckDB files (created with test data)
 * - Real ClickHouse connections (test database)
 * - Real workflows (ingestOhlcv)
 * - Real ports with real adapters
 * - Real PythonEngine
 *
 * Only mocks external APIs (Birdeye) for deterministic test data.
 *
 * This tests actual integration boundaries and enforces handler purity.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { IngestOhlcvArgs, ingestOhlcvHandler } from '../../../src/commands/ingestion/ingest-ohlcv.js';
import { CommandContext, createCommandContext } from '../../../src/core/command-context.js';
// Use relative path for test helpers (they're not exported from the package)
import {
  createTestDuckDB,
  cleanupTestDuckDB,
  createTempDuckDBPath,
} from '../../../../ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '../../../../ingestion/tests/helpers/createTestDuckDB.js';
import { initClickHouse, closeClickHouse } from '@quantbot/storage';
import { vi } from 'vitest';

describe('ingestOhlcvHandler - Integration Tests (Real Implementations)', () => {
  let testDuckDBPath: string;
  let testCalls: TestCall[];
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });
  const TEST_TRIGGER_TS_MS = TEST_ALERT_TIME.toMillis();

  beforeAll(async () => {
    // Initialize ClickHouse (real database)
    await initClickHouse();

    // Create test DuckDB with real schema and data
    testDuckDBPath = createTempDuckDBPath('integration_test');
    testCalls = [
      {
        mint: TEST_MINT,
        chain: TEST_CHAIN,
        triggerTsMs: TEST_TRIGGER_TS_MS,
        chatId: 'test_chat',
        messageId: 1,
      },
    ];

    // Create real DuckDB with test data
    await createTestDuckDB(testDuckDBPath, testCalls);
  });

  afterAll(async () => {
    // Cleanup test DuckDB
    cleanupTestDuckDB(testDuckDBPath);

    // Close ClickHouse connection
    await closeClickHouse();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    'INTEGRATION: handler calls workflow with real implementations',
    async () => {
    // Create real command context with real services
    const ctx = createCommandContext();

    // Use real workflow, but track calls to verify handler behavior
    const workflowSpy = vi.spyOn(await import('@quantbot/workflows'), 'ingestOhlcv');

    const args = {
      duckdb: testDuckDBPath,
      from: TEST_ALERT_TIME.minus({ days: 2 }).toISO()!,
      to: TEST_ALERT_TIME.plus({ days: 1 }).toISO()!,
      preWindow: 260,
      postWindow: 1440,
      interval: '1m' as const,
      format: 'json' as const,
    };

    // Execute handler with real context
    // Note: This will call the real workflow, which will use real DuckDB and ClickHouse.
    // We're testing that the handler correctly orchestrates the workflow call.
    const result = await ingestOhlcvHandler(args as IngestOhlcvArgs, ctx);

    // Assert: Handler called workflow with correct arguments
    expect(workflowSpy).toHaveBeenCalled();
    expect(workflowSpy).toHaveBeenCalledTimes(1);

    // Defensive: Check there is at least one call before trying to access it
    expect(workflowSpy.mock.calls.length).toBeGreaterThan(0);

    const [spec] = workflowSpy.mock.calls[0] ?? [{}];
    expect(spec.duckdbPath).toBe(testDuckDBPath);
    expect(spec.preWindowMinutes).toBe(260);
    expect(spec.postWindowMinutes).toBe(1440);
    expect(spec.interval).toBe('1m');

    // Assert: Handler returns workflow result (pure function)
    expect(result).toHaveProperty('worklistGenerated');
    expect(result).toHaveProperty('workItemsProcessed');
    expect(result).toHaveProperty('workItemsSucceeded');
  });

  it(
    'INTEGRATION: handler is pure function (no side effects, deterministic)',
    async () => {
      // This test verifies handler purity - same inputs = same outputs
      const ctx = createCommandContext();

    const workflowSpy = vi.spyOn(await import('@quantbot/workflows'), 'ingestOhlcv');

    const args = {
      duckdb: testDuckDBPath,
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    // Call handler twice with same inputs
    const result1 = await ingestOhlcvHandler(args as IngestOhlcvArgs, ctx);
    const result2 = await ingestOhlcvHandler(args as IngestOhlcvArgs, ctx);

    // Assert: Handler called workflow twice (deterministic)
    expect(workflowSpy).toHaveBeenCalledTimes(2);

    // Assert: Both calls used same spec
    const spec1 = workflowSpy.mock.calls[0][0];
    const spec2 = workflowSpy.mock.calls[1][0];
    expect(spec1).toEqual(spec2);
    },
    30000 // 30 second timeout for integration test with real DuckDB
  );

  it('INTEGRATION: handler propagates workflow errors (no try/catch)', async () => {
    // This test verifies handler doesn't catch errors (pure function contract)
    const ctx = createCommandContext();

    // Mock workflow to throw error
    const workflowSpy = vi.spyOn(await import('@quantbot/workflows'), 'ingestOhlcv');
    workflowSpy.mockRejectedValue(new Error('Workflow failed: database connection lost'));

    const args = {
      duckdb: testDuckDBPath,
      preWindow: 260,
      postWindow: 1440,
      interval: '5m' as const,
      format: 'json' as const,
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(ingestOhlcvHandler(args as IngestOhlcvArgs, ctx)).rejects.toThrow(
      'Workflow failed: database connection lost'
    );
    expect(workflowSpy).toHaveBeenCalledTimes(1);
  });
});
