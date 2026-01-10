/**
 * Integration Tests for ingestOhlcv Workflow
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
 *
 * This tests actual integration boundaries and enforces architectural boundaries.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { ingestOhlcv } from '../../src/ohlcv/ingestOhlcv.js';
import { createTestWorkflowContext } from '../helpers/createTestContext.js';
// Use relative path for test helpers (they're not exported from the package)
import {
  createTestDuckDB,
  cleanupTestDuckDB,
  createTempDuckDBPath,
} from '../../../ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '../../../ingestion/tests/helpers/createTestDuckDB.js';
import { initClickHouse, closeClickHouse } from '@quantbot/storage';
import { shouldRunDbStress } from '@quantbot/utils/test-helpers/test-gating';
import { vi } from 'vitest';
import type { Candle } from '@quantbot/core';

// Gate this test suite behind RUN_DB_STRESS=1
// These tests require real database connections (ClickHouse, DuckDB)
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)(
  'ingestOhlcv Workflow - Integration Tests (Real Implementations)',
  () => {
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

    it('INTEGRATION: generates worklist from real DuckDB and processes items', async () => {
      // Create real workflow context with real ports
      const { context, cleanup } = await createTestWorkflowContext({
        duckdbPath: testDuckDBPath,
        testCalls,
        mockExternalApis: true, // Mock Birdeye API for deterministic test data
      });

      // Mock market data port to return test candles (real adapter, mocked response)
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds()) + 60,
          open: 1.05,
          high: 1.15,
          low: 0.95,
          close: 1.1,
          volume: 2000,
        },
      ];

      // Override marketData.fetchOhlcv to return test data (real adapter, mocked response)
      context.ports.marketData.fetchOhlcv = vi.fn().mockResolvedValue(mockCandles);

      try {
        // Execute workflow with real implementations
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
            checkCoverage: false, // Disable coverage check for this test
            rateLimitMs: 100,
            maxRetries: 3,
          },
          context
        );

        // Assert: Workflow completed successfully
        expect(result.worklistGenerated).toBeGreaterThan(0);
        expect(result.workItemsProcessed).toBeGreaterThan(0);
        expect(result.workItemsSucceeded).toBeGreaterThan(0);
        expect(result.totalCandlesFetched).toBeGreaterThan(0);
        expect(result.totalCandlesStored).toBeGreaterThan(0);

        // Assert: Result is JSON-serializable
        const jsonString = JSON.stringify(result);
        const parsed = JSON.parse(jsonString);
        expect(parsed).toEqual(result);

        // Assert: Market data port was called (real adapter)
        expect(context.ports.marketData.fetchOhlcv).toHaveBeenCalled();

        // Assert: State port was used for idempotency (real adapter)
        expect(context.ports.state.get).toHaveBeenCalled();
        expect(context.ports.state.set).toHaveBeenCalled();
      } finally {
        cleanup();
      }
    });

    it('INTEGRATION: handles empty worklist gracefully', async () => {
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

    it('INTEGRATION: enforces architectural boundaries (uses ports, not direct clients)', async () => {
      // This test verifies that the workflow uses ports, not direct clients
      // This is a boundary enforcement test

      const { context, cleanup } = await createTestWorkflowContext({
        duckdbPath: testDuckDBPath,
        testCalls,
        mockExternalApis: true,
      });

      // Track port usage
      const portCalls = {
        marketData: 0,
        state: 0,
        telemetry: 0,
      };

      // Wrap ports to track calls
      const originalMarketData = context.ports.marketData.fetchOhlcv;
      context.ports.marketData.fetchOhlcv = vi.fn().mockImplementation(async (...args) => {
        portCalls.marketData++;
        return originalMarketData.call(context.ports.marketData, ...args);
      });

      const originalStateGet = context.ports.state.get;
      context.ports.state.get = vi.fn().mockImplementation(async (...args) => {
        portCalls.state++;
        return originalStateGet.call(context.ports.state, ...args);
      });

      const originalTelemetry = context.ports.telemetry.emitEvent;
      context.ports.telemetry.emitEvent = vi.fn().mockImplementation((...args) => {
        portCalls.telemetry++;
        return originalTelemetry.call(context.ports.telemetry, ...args);
      });

      try {
        await ingestOhlcv(
          {
            duckdbPath: testDuckDBPath,
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

        // Assert: Workflow uses ports (architectural boundary enforced)
        expect(portCalls.marketData).toBeGreaterThan(0);
        expect(portCalls.state).toBeGreaterThan(0);
        expect(portCalls.telemetry).toBeGreaterThan(0);
      } finally {
        cleanup();
      }
    });
  }
);
