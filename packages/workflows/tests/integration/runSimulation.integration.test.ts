import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { runSimulation } from '../../src/simulation/runSimulation.js';
import { createProductionContext } from '../../src/context/createProductionContext.js';
import { initClickHouse, closeClickHouse, StrategiesRepository } from '@quantbot/storage';
import { shouldRunDbStress, TEST_GATES } from '@quantbot/utils/test-helpers/test-gating';

// Gate this test suite behind RUN_DB_STRESS=1
// These tests require real database connections (ClickHouse, Postgres)
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)('workflows.runSimulation - integration tests', () => {
  beforeAll(async () => {
    // Initialize database connections
    await initClickHouse();

    // Ensure IchimokuV1 strategy exists for tests
    // Use default DuckDB path from environment or temp file
    const dbPath = process.env.DUCKDB_PATH || '/tmp/test_strategies.duckdb';
    const strategiesRepo = new StrategiesRepository(dbPath);
    const existing = await strategiesRepo.findByName('IchimokuV1', '1');
    if (!existing) {
      await strategiesRepo.create({
        name: 'IchimokuV1',
        version: '1',
        category: 'indicator-based',
        description: 'Ichimoku cloud strategy with dynamic profit targets',
        config: {
          legs: [
            { target: 2.0, percent: 0.3 },
            { target: 3.0, percent: 0.3 },
            { target: 5.0, percent: 0.4 },
          ],
          stopLoss: {
            initial: -0.25,
            trailing: 0.1,
          },
          entry: {
            type: 'immediate',
          },
          costs: {
            entryFee: 0.01,
            exitFee: 0.01,
            slippage: 0.005,
          },
        },
        isActive: true,
      });
    }
  });

  afterAll(async () => {
    // Clean up connections
    await closeClickHouse();
  });

  it.skip('INTEGRATION: runs simulation with real database and OHLCV', async () => {
    // This test requires:
    // 1. ClickHouse running with strategies, calls, and OHLCV data
    // 2. Network access for Birdeye API (fallback)

    const ctx = createProductionContext();

    const spec = {
      strategyName: 'IchimokuV1', // Must exist in database
      callerName: 'Brook', // Must have calls in database
      from: DateTime.fromISO('2025-10-01T00:00:00.000Z', { zone: 'utc' }),
      to: DateTime.fromISO('2025-10-15T00:00:00.000Z', { zone: 'utc' }),
      options: {
        dryRun: true,
        preWindowMinutes: 60,
        postWindowMinutes: 120,
      },
    };

    const result = await runSimulation(spec, ctx);

    // Basic assertions
    expect(result.runId).toBeDefined();
    expect(result.strategyName).toBe('IchimokuV1');
    expect(result.totals.callsFound).toBeGreaterThanOrEqual(0);

    // Log results for manual inspection
    console.log('Integration test results:', {
      runId: result.runId,
      totals: result.totals,
      pnl: result.pnl,
      sampleResults: result.results.slice(0, 3),
    });
  });

  it('INTEGRATION: handles missing strategy gracefully', async () => {
    const ctx = createProductionContext();

    const spec = {
      strategyName: 'NonExistentStrategy_12345',
      from: DateTime.fromISO('2025-10-01T00:00:00.000Z', { zone: 'utc' }),
      to: DateTime.fromISO('2025-10-15T00:00:00.000Z', { zone: 'utc' }),
      options: {
        dryRun: true,
      },
    };

    await expect(runSimulation(spec, ctx)).rejects.toThrow(/STRATEGY_NOT_FOUND/);
  });

  it('INTEGRATION: handles empty date range (no calls)', async () => {
    const ctx = createProductionContext();

    const spec = {
      strategyName: 'IchimokuV1',
      // Use a date range in the far future where no calls exist
      from: DateTime.fromISO('2099-01-01T00:00:00.000Z', { zone: 'utc' }),
      to: DateTime.fromISO('2099-01-02T00:00:00.000Z', { zone: 'utc' }),
      options: {
        dryRun: true,
      },
    };

    const result = await runSimulation(spec, ctx);

    expect(result.totals.callsFound).toBe(0);
    expect(result.totals.callsAttempted).toBe(0);
    expect(result.results).toEqual([]);
  });
});
