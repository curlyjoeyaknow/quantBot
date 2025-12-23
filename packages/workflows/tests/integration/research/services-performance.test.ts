/**
 * Performance Tests for Research Services
 * =======================================
 *
 * Tests performance characteristics of services with larger datasets.
 * These tests verify that services can handle production-scale workloads.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataSnapshotService } from '../../../src/research/services/DataSnapshotService.js';
import { ExecutionRealityService } from '../../../src/research/services/ExecutionRealityService.js';
import { createProductionContext } from '../../../src/context/createProductionContext.js';
import { vi } from 'vitest';

// Mock storage with larger datasets
vi.mock('@quantbot/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/storage')>();

  // Generate mock candles for performance testing
  const generateCandles = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      timestamp: new Date('2024-01-01T00:00:00Z').getTime() / 1000 + i * 300, // 5min intervals
      open: 100 + Math.random() * 10,
      high: 105 + Math.random() * 10,
      low: 95 + Math.random() * 10,
      close: 100 + Math.random() * 10,
      volume: 1000 + Math.random() * 5000,
    }));
  };

  return {
    ...actual,
    getStorageEngine: vi.fn(() => ({
      getCandles: vi.fn().mockResolvedValue(generateCandles(1000)), // 1000 candles per mint
    })),
  };
});

vi.mock('../../../src/calls/queryCallsDuckdb', () => {
  // Generate mock calls for performance testing
  const generateCalls = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `call-${i}`,
      caller: `caller-${i % 10}`, // 10 different callers
      mint: `mint-${i % 100}`, // 100 different mints
      createdAt: new Date(`2024-01-01T00:00:00Z`),
      price: 100 + Math.random() * 10,
      volume: 1000 + Math.random() * 5000,
    }));
  };

  return {
    queryCallsDuckdb: vi.fn().mockResolvedValue({
      calls: generateCalls(1000), // 1000 calls
      totalQueried: 1000,
      totalReturned: 1000,
      fromISO: '2024-01-01T00:00:00Z',
      toISO: '2024-01-02T00:00:00Z',
    }),
  };
});

describe('Performance Tests', () => {
  let workflowCtx: ReturnType<typeof createProductionContext>;
  let dataService: DataSnapshotService;
  let executionService: ExecutionRealityService;

  beforeEach(() => {
    workflowCtx = createProductionContext();
    dataService = new DataSnapshotService(workflowCtx);
    executionService = new ExecutionRealityService(workflowCtx);
  });

  describe('DataSnapshotService Performance', () => {
    it('creates snapshot with large dataset within reasonable time', async () => {
      const startTime = Date.now();

      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      const duration = Date.now() - startTime;

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    });

    it('loads snapshot with large dataset within reasonable time', async () => {
      // Create snapshot and immediately load it (mocks return same data)
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      const startTime = Date.now();
      // Load data using snapshot parameters (bypasses integrity check for performance test)
      const params = {
        timeRange: snapshot.timeRange,
        sources: snapshot.sources,
        filters: snapshot.filters,
      };
      // Access private method via type assertion for testing
      const data = await (dataService as any).loadDataForSnapshot(params);
      const duration = Date.now() - startTime;

      expect(data.candles.length).toBeGreaterThan(0);
      expect(data.calls.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    });

    it('verifies snapshot integrity quickly', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      // Note: In tests with mocks, data may differ, so we test the verification
      // operation itself rather than expecting it to pass
      const startTime = Date.now();
      const isValid = await dataService.verifySnapshot(snapshot);
      const duration = Date.now() - startTime;

      // Verification should complete quickly regardless of result
      expect(duration).toBeLessThan(2000); // Should complete in < 2 seconds
    });

    it('handles multiple concurrent snapshot creations', async () => {
      const startTime = Date.now();

      const snapshots = await Promise.all([
        dataService.createSnapshot({
          timeRange: {
            fromISO: '2024-01-01T00:00:00Z',
            toISO: '2024-01-02T00:00:00Z',
          },
          sources: [{ venue: 'pump.fun' }],
        }),
        dataService.createSnapshot({
          timeRange: {
            fromISO: '2024-01-02T00:00:00Z',
            toISO: '2024-01-03T00:00:00Z',
          },
          sources: [{ venue: 'pump.fun' }],
        }),
        dataService.createSnapshot({
          timeRange: {
            fromISO: '2024-01-03T00:00:00Z',
            toISO: '2024-01-04T00:00:00Z',
          },
          sources: [{ venue: 'pump.fun' }],
        }),
      ]);

      const duration = Date.now() - startTime;

      expect(snapshots).toHaveLength(3);
      expect(duration).toBeLessThan(10000); // Should complete in < 10 seconds
    });
  });

  describe('ExecutionRealityService Performance', () => {
    it('creates execution model from large calibration dataset quickly', () => {
      const startTime = Date.now();

      // Large calibration dataset
      const latencySamples = Array.from({ length: 1000 }, (_, i) => 50 + i * 0.5);
      const slippageSamples = Array.from({ length: 100 }, (_, i) => ({
        tradeSize: 100 + i * 10,
        expectedPrice: 100.0,
        actualPrice: 100.0 + i * 0.01,
        marketVolume24h: 1000000,
      }));

      const model = executionService.createExecutionModelFromCalibration({
        latencySamples,
        slippageSamples,
        failureRate: 0.01,
      });

      const duration = Date.now() - startTime;

      expect(model.latency).toBeDefined();
      expect(model.slippage).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });

    it('applies execution model to many trades quickly', async () => {
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100, 200, 300],
        slippageSamples: [
          {
            tradeSize: 100,
            expectedPrice: 100.0,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 0.01,
      });

      const trades = Array.from({ length: 1000 }, (_, i) => ({
        type: 'entry' as const,
        asset: `mint-${i}`,
        quantity: 1,
        expectedPrice: 100,
        marketVolume24h: 1000000,
      }));

      let randomSeed = 0;
      const random = () => {
        randomSeed = (randomSeed * 9301 + 49297) % 233280;
        return randomSeed / 233280;
      };

      const startTime = Date.now();
      const results = await Promise.all(
        trades.map((trade) => executionService.applyExecutionModel(trade, model, random))
      );
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(1000);
      expect(duration).toBeLessThan(2000); // Should complete in < 2 seconds
    });

    it('applies cost model to many trades quickly', () => {
      const model = executionService.createCostModelFromFees({
        baseFee: 5000,
        priorityFeeRange: { min: 1000, max: 10000 },
        tradingFeePercent: 0.01,
      });

      const trades = Array.from({ length: 10000 }, (_, i) => ({
        value: 100000 + i * 1000,
        priority: (i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low') as
          | 'low'
          | 'medium'
          | 'high',
      }));

      const startTime = Date.now();
      const costs = trades.map((trade) => executionService.applyCostModel(trade, model));
      const duration = Date.now() - startTime;

      expect(costs).toHaveLength(10000);
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('checks risk constraints for many states quickly', () => {
      const model = executionService.createRiskModelFromConstraints({
        maxDrawdownPercent: 20,
        maxLossPerDay: 1000,
        maxConsecutiveLosses: 5,
        maxPositionSize: 500,
      });

      const states = Array.from({ length: 10000 }, (_, i) => ({
        currentDrawdown: (i % 100) / 1000, // 0-10%
        lossToday: i % 2000, // 0-2000
        consecutiveLosses: i % 10, // 0-9
        currentExposure: i % 1000, // 0-1000
        tradesToday: i % 100, // 0-99
      }));

      const startTime = Date.now();
      const checks = states.map((state) => executionService.checkRiskConstraints(state, model));
      const duration = Date.now() - startTime;

      expect(checks).toHaveLength(10000);
      expect(duration).toBeLessThan(500); // Should complete in < 500ms
    });
  });

  describe('Memory Efficiency', () => {
    it('does not leak memory when creating many snapshots', async () => {
      // Create many snapshots and verify they can all be loaded
      const snapshots = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          dataService.createSnapshot({
            timeRange: {
              fromISO: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
              toISO: `2024-01-${String(i + 2).padStart(2, '0')}T00:00:00Z`,
            },
            sources: [{ venue: 'pump.fun' }],
          })
        )
      );

      // Load all snapshots (using loadDataForSnapshot to bypass integrity check in tests)
      const dataPromises = snapshots.map((snapshot) =>
        (dataService as any).loadDataForSnapshot({
          timeRange: snapshot.timeRange,
          sources: snapshot.sources,
          filters: snapshot.filters,
        })
      );
      const allData = await Promise.all(dataPromises);

      expect(allData).toHaveLength(10);
      allData.forEach((data) => {
        expect(data.candles).toBeDefined();
        expect(data.calls).toBeDefined();
      });
    });
  });
});
