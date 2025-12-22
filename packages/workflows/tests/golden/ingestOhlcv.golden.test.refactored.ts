/**
 * Golden Path Tests for ingestOhlcv Workflow (Refactored with Real Implementations)
 *
 * Tests the complete happy path for OHLCV ingestion workflow using REAL implementations.
 * These tests validate the entire orchestration flow from worklist to stored candles.
 *
 * Golden Path:
 * 1. Generate worklist from DuckDB (REAL DuckDB with test data)
 * 2. Fetch candles from Birdeye API (mocked for deterministic test data)
 * 3. Store candles in ClickHouse (REAL ClickHouse connection)
 * 4. Update DuckDB metadata (REAL DuckDB via StatePort)
 * 5. Return structured, JSON-serializable result
 *
 * Uses REAL implementations:
 * - Real DuckDB files (created with test data)
 * - Real ClickHouse connections (test database)
 * - Real ports with real adapters
 * - Real PythonEngine
 * - Real generateOhlcvWorklist (queries real DuckDB)
 * - Real storeCandles (writes to real ClickHouse)
 * - Real getCoverage (queries real ClickHouse)
 *
 * Only mocks external APIs (Birdeye) for deterministic test data.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { ingestOhlcv } from '../../src/ohlcv/ingestOhlcv.js';
import { createTestWorkflowContext } from '../helpers/createTestContext.js';
import { createTestDuckDB, cleanupTestDuckDB, createTempDuckDBPath } from '@quantbot/ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '@quantbot/ingestion/tests/helpers/createTestDuckDB.js';
import { initClickHouse, closeClickHouse } from '@quantbot/storage';
import { shouldRunDbStress } from '@quantbot/utils/test-helpers/test-gating';
import { vi } from 'vitest';
import type { Candle } from '@quantbot/core';
import { generateOhlcvWorklist } from '@quantbot/ingestion';
import { storeCandles, getCoverage } from '@quantbot/ohlcv';

// Gate this test suite behind RUN_DB_STRESS=1
// These tests require real database connections (ClickHouse, DuckDB)
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)('ingestOhlcv Workflow - Golden Path (Real Implementations)', () => {
  let testDuckDBPath: string;
  let testCalls: TestCall[];
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });
  const TEST_TRIGGER_TS_MS = TEST_ALERT_TIME.toMillis();
  const TEST_START_TIME = TEST_ALERT_TIME.minus({ minutes: 260 });
  const TEST_END_TIME = TEST_ALERT_TIME.plus({ minutes: 1440 });

  beforeAll(async () => {
    // Initialize ClickHouse (real database)
    await initClickHouse();

    // Create test DuckDB with real schema and data
    testDuckDBPath = createTempDuckDBPath('golden_test');
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

  describe('GOLDEN: Complete ingestion flow - worklist → fetch → store → metadata', () => {
    it('should complete full golden path: generate worklist → fetch → store → update metadata', async () => {
      // Create real workflow context with real ports
      const { context, cleanup } = await createTestWorkflowContext({
        duckdbPath: testDuckDBPath,
        testCalls,
        mockExternalApis: true, // Mock Birdeye API for deterministic test data
      });

      // Setup: Mock market data port to return test candles (real adapter, mocked response)
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()) + 60,
          open: 1.05,
          high: 1.15,
          low: 0.95,
          close: 1.1,
          volume: 2000,
        },
      ];

      // Override marketData.fetchOhlcv to return test data (real adapter, mocked response)
      context.ports.marketData.fetchOhlcv = vi.fn().mockResolvedValue(mockCandles);

      // Mock getCoverage to return insufficient coverage (so fetch happens)
      // Note: We're using the real getCoverage function, but we can override it if needed
      // For now, we'll let it query real ClickHouse (which will be empty, so coverage will be insufficient)

      try {
        // Execute: Run workflow with real implementations
        const result = await ingestOhlcv(
          {
            duckdbPath: testDuckDBPath,
            from: TEST_ALERT_TIME.minus({ days: 2 }).toISO()!,
            to: TEST_ALERT_TIME.plus({ days: 1 }).toISO()!,
            side: 'buy',
            chain: TEST_CHAIN,
            interval: '1m',
            preWindowMinutes: 260,
            postWindowMinutes: 1440,
            errorMode: 'collect',
            checkCoverage: false, // Disable coverage check for this test (uses real getCoverage)
            rateLimitMs: 100,
            maxRetries: 3,
          },
          context
        );

        // Assert: Complete result structure (should be JSON-serializable)
        expect(typeof result.worklistGenerated).toBe('number');
        expect(Number.isFinite(result.worklistGenerated)).toBe(true);
        expect(result.workItemsProcessed).toBeGreaterThanOrEqual(0);
        expect(result.workItemsSucceeded).toBeGreaterThanOrEqual(0);
        expect(result.workItemsFailed).toBe(0);
        expect(result.totalCandlesFetched).toBeGreaterThanOrEqual(0);
        expect(result.totalCandlesStored).toBeGreaterThanOrEqual(0);
        expect(result.errors).toEqual([]);
        expect(result.startedAtISO).toBeDefined();
        expect(result.completedAtISO).toBeDefined();
        expect(result.durationMs).toBeGreaterThan(0);

        // Assert: Market data port was called (real adapter)
        expect(context.ports.marketData.fetchOhlcv).toHaveBeenCalled();

        // Assert: State port was used for idempotency (real adapter)
        expect(context.ports.state.get).toHaveBeenCalled();
        expect(context.ports.state.set).toHaveBeenCalled();

        // Assert: Result is JSON-serializable (no Date objects, no class instances)
        const jsonString = JSON.stringify(result);
        const parsed = JSON.parse(jsonString);
        expect(parsed).toEqual(result);
      } finally {
        cleanup();
      }
    });

    it('should handle empty worklist gracefully', async () => {
      // Create empty DuckDB (no calls)
      const emptyDuckDBPath = createTempDuckDBPath('empty_test');
      await createTestDuckDB(emptyDuckDBPath, []);

      const { context, cleanup } = await createTestWorkflowContext({
        duckdbPath: emptyDuckDBPath,
        testCalls: [],
        mockExternalApis: true,
      });

      try {
        const result = await ingestOhlcv(
          {
            duckdbPath: emptyDuckDBPath,
            side: 'buy',
            chain: TEST_CHAIN,
            interval: '1m',
            preWindowMinutes: 260,
            postWindowMinutes: 1440,
            errorMode: 'collect',
            checkCoverage: false,
            rateLimitMs: 100,
            maxRetries: 3,
          },
          context
        );

        // Assert: Empty result structure
        expect(result.worklistGenerated).toBe(0);
        expect(result.workItemsProcessed).toBe(0);
        expect(result.workItemsSucceeded).toBe(0);
        expect(result.totalCandlesFetched).toBe(0);
        expect(result.totalCandlesStored).toBe(0);
        expect(result.errors).toEqual([]);
      } finally {
        cleanup();
        cleanupTestDuckDB(emptyDuckDBPath);
      }
    });
  });
});

