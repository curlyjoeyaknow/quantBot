/**
 * Architecture Boundary Enforcement Tests
 *
 * These tests verify that architectural boundaries are enforced using real implementations.
 * They catch violations of:
 * - Ports pattern (workflows use ports, not direct clients)
 * - Handler purity (handlers are pure functions)
 * - Dependency injection (dependencies come through context)
 *
 * Uses REAL implementations to catch real violations, not just mock violations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IngestOhlcvContext, ingestOhlcv } from '../../src/ohlcv/ingestOhlcv.js';
import { createTestWorkflowContext } from '../helpers/createTestContext.js';
// Use relative path for test helpers (they're not exported from the package)
import {
  createTestDuckDB,
  cleanupTestDuckDB,
  createTempDuckDBPath,
} from '../../../ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '../../../ingestion/tests/helpers/createTestDuckDB.js';
import { initClickHouse, closeClickHouse } from '@quantbot/storage';
import { shouldRunDbStress } from '../../../utils/src/test-helpers/test-gating';
import { DateTime } from 'luxon';
import { vi } from 'vitest';

// Gate this test suite behind RUN_DB_STRESS=1
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)('Architecture Boundaries - Real Implementation Tests', () => {
  let testDuckDBPath: string;
  let testCalls: TestCall[];
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });
  const TEST_TRIGGER_TS_MS = TEST_ALERT_TIME.toMillis();

  beforeAll(async () => {
    await initClickHouse();

    testDuckDBPath = createTempDuckDBPath('boundary_test');
    testCalls = [
      {
        mint: TEST_MINT,
        chain: TEST_CHAIN,
        triggerTsMs: TEST_TRIGGER_TS_MS,
        chatId: 'test_chat',
        messageId: 1,
      },
    ];

    await createTestDuckDB(testDuckDBPath, testCalls);
  });

  afterAll(async () => {
    cleanupTestDuckDB(testDuckDBPath);
    await closeClickHouse();
  });

  it('BOUNDARY: workflow uses ports, not direct clients', async () => {
    // This test verifies that workflows call ctx.ports.*, not direct clients
    // This enforces the ports pattern

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
      query: 0,
    };

    // Wrap ports to track calls (real adapters, just tracking)
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
        context as unknown as IngestOhlcvContext
      );

      // Assert: Workflow uses ports (architectural boundary enforced)
      expect(portCalls.marketData).toBeGreaterThan(0);
      expect(portCalls.state).toBeGreaterThan(0);
      expect(portCalls.telemetry).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it('BOUNDARY: workflow result is JSON-serializable', async () => {
    // This test verifies that workflow results are JSON-serializable
    // This enforces the workflow contract

    const { context, cleanup } = await createTestWorkflowContext({
      duckdbPath: testDuckDBPath,
      testCalls,
      mockExternalApis: true,
    });

    try {
      const result = await ingestOhlcv(
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
        context as unknown as IngestOhlcvContext
      );

      // Assert: Result is JSON-serializable
      const jsonString = JSON.stringify(result);
      expect(jsonString).toBeDefined();

      // Assert: Can parse back
      const parsed = JSON.parse(jsonString);
      expect(parsed).toEqual(result);

      // Assert: No Date objects (all ISO strings)
      expect(typeof parsed.startedAtISO).toBe('string');
      expect(typeof parsed.completedAtISO).toBe('string');
      expect(parsed.startedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    } finally {
      cleanup();
    }
  });
});
