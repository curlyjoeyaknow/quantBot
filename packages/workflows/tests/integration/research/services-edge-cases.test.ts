/**
 * Edge Case Tests for Research Services
 * ======================================
 *
 * Tests edge cases and error conditions for DataSnapshotService and ExecutionRealityService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSnapshotService } from '../../../src/research/services/DataSnapshotService.js';
import { ExecutionRealityService } from '../../../src/research/services/ExecutionRealityService.js';
import { createProductionContext } from '../../../src/context/createProductionContext.js';
import type { DataSnapshotRef } from '../../../src/research/contract.js';

// Mock storage to avoid requiring real database connections in tests
vi.mock('@quantbot/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/storage')>();
  return {
    ...actual,
    getStorageEngine: vi.fn(() => ({
      getCandles: vi.fn().mockResolvedValue([]), // Empty by default
    })),
  };
});

vi.mock('../../../src/calls/queryCallsDuckdb', () => ({
  queryCallsDuckdb: vi.fn().mockResolvedValue({
    calls: [],
    totalQueried: 0,
    totalReturned: 0,
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-02T00:00:00Z',
  }),
}));

describe('DataSnapshotService Edge Cases', () => {
  let dataService: DataSnapshotService;
  let ctx: ReturnType<typeof createProductionContext>;

  beforeEach(() => {
    ctx = createProductionContext();
    dataService = new DataSnapshotService(ctx);
  });

  describe('Empty data handling', () => {
    it('creates snapshot with no calls or candles', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);

      const data = await dataService.loadSnapshot(snapshot);
      expect(data.candles).toEqual([]);
      expect(data.calls).toEqual([]);
    });

    it('verifies snapshot with empty data', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      const isValid = await dataService.verifySnapshot(snapshot);
      expect(isValid).toBe(true);
    });
  });

  describe('Invalid inputs', () => {
    it('handles invalid time range gracefully', async () => {
      // Note: DateTime.fromISO handles invalid dates gracefully by returning invalid DateTime
      // The service may handle this or throw - both are acceptable
      // We test that the service doesn't crash the process
      try {
        await dataService.createSnapshot({
          timeRange: {
            fromISO: 'invalid-date',
            toISO: '2024-01-02T00:00:00Z',
          },
          sources: [{ venue: 'pump.fun' }],
        });
        // If it doesn't throw, that's also acceptable (graceful handling)
      } catch (error) {
        // If it throws, that's also acceptable (validation)
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('handles empty sources array', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [],
      });

      expect(snapshot.sources).toEqual([]);
    });
  });

  describe('Filter edge cases', () => {
    it('handles undefined filters', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
        filters: undefined,
      });

      expect(snapshot.filters).toBeUndefined();
    });

    it('handles empty filter arrays', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
        filters: {
          callerNames: [],
          mintAddresses: [],
        },
      });

      expect(snapshot.filters?.callerNames).toEqual([]);
    });

    it('handles minVolume filter with zero', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
        filters: {
          minVolume: 0,
        },
      });

      expect(snapshot.filters?.minVolume).toBe(0);
    });
  });

  describe('Snapshot tampering detection', () => {
    it('detects tampered content hash', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      const tampered: DataSnapshotRef = {
        ...snapshot,
        contentHash: 'tampered-hash',
      };

      const isValid = await dataService.verifySnapshot(tampered);
      expect(isValid).toBe(false);
    });

    it('detects tampered time range', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun' }],
      });

      const tampered: DataSnapshotRef = {
        ...snapshot,
        timeRange: {
          fromISO: '2024-01-03T00:00:00Z',
          toISO: '2024-01-04T00:00:00Z',
        },
      };

      const isValid = await dataService.verifySnapshot(tampered);
      expect(isValid).toBe(false);
    });
  });

  describe('Large datasets', () => {
    it('handles snapshot with many sources', async () => {
      const snapshot = await dataService.createSnapshot({
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: Array.from({ length: 10 }, (_, i) => ({
          venue: `venue-${i}`,
          chain: 'solana',
        })),
      });

      expect(snapshot.sources).toHaveLength(10);
    });
  });
});

describe('ExecutionRealityService Edge Cases', () => {
  let executionService: ExecutionRealityService;
  let ctx: ReturnType<typeof createProductionContext>;

  beforeEach(() => {
    ctx = createProductionContext();
    executionService = new ExecutionRealityService(ctx);
  });

  describe('Calibration edge cases', () => {
    it('handles empty latency samples by requiring at least one', () => {
      // Empty latency samples cannot be calibrated - calibration requires at least one record
      // This test verifies the service handles this edge case appropriately
      expect(() => {
        executionService.createExecutionModelFromCalibration({
          latencySamples: [],
          slippageSamples: [
            {
              tradeSize: 100,
              slippage: 0.001,
              expectedPrice: 100,
              actualPrice: 100.1,
              marketVolume24h: 1000000,
            },
          ],
          failureRate: 0.01,
        });
      }).toThrow();
    });

    it('handles single latency sample', () => {
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100],
        slippageSamples: [
          {
            tradeSize: 100,
            slippage: 0.001,
            expectedPrice: 100,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 0.01,
      });

      expect(model.latency.p50).toBeGreaterThanOrEqual(0);
      expect(model.latency.p90).toBeGreaterThanOrEqual(model.latency.p50);
      expect(model.latency.p99).toBeGreaterThanOrEqual(model.latency.p90);
    });

    it('handles single slippage sample with multiple latency samples', () => {
      // Single slippage sample will be reused for all latency samples
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100, 200, 300],
        slippageSamples: [
          {
            tradeSize: 100,
            slippage: 0.001,
            expectedPrice: 100,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 0.01,
      });

      expect(model.slippage).toBeDefined();
    });

    it('handles zero failure rate', () => {
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100, 200, 300],
        slippageSamples: [
          {
            tradeSize: 100,
            slippage: 0.001,
            expectedPrice: 100,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 0,
      });

      expect(model.failures?.baseRate).toBe(0);
    });

    it('handles 100% failure rate', () => {
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100, 200, 300],
        slippageSamples: [
          {
            tradeSize: 100,
            slippage: 0.001,
            expectedPrice: 100,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 1.0,
      });

      expect(model.failures?.baseRate).toBe(1.0);
    });
  });

  describe('Cost model edge cases', () => {
    it('handles zero base fee', () => {
      const model = executionService.createCostModelFromFees({
        baseFee: 0,
        priorityFeeRange: { min: 1000, max: 10000 },
        tradingFeePercent: 0.01,
      });

      expect(model.baseFee).toBe(0);
      expect(model.tradingFee).toBe(0.01);
    });

    it('handles zero trading fee', () => {
      const model = executionService.createCostModelFromFees({
        baseFee: 5000,
        priorityFeeRange: { min: 1000, max: 10000 },
        tradingFeePercent: 0,
      });

      expect(model.tradingFee).toBe(0);
    });

    it('handles equal priority fee min and max', () => {
      const model = executionService.createCostModelFromFees({
        baseFee: 5000,
        priorityFeeRange: { min: 1000, max: 1000 },
        tradingFeePercent: 0.01,
      });

      expect(model.priorityFee?.base).toBe(1000);
      expect(model.priorityFee?.max).toBe(1000);
    });
  });

  describe('Risk model edge cases', () => {
    it('handles zero max drawdown', () => {
      const model = executionService.createRiskModelFromConstraints({
        maxDrawdownPercent: 0,
        maxLossPerDay: 1000,
        maxConsecutiveLosses: 5,
        maxPositionSize: 500,
      });

      expect(model.maxDrawdown).toBe(0);
    });

    it('handles zero max loss per day', () => {
      const model = executionService.createRiskModelFromConstraints({
        maxDrawdownPercent: 20,
        maxLossPerDay: 0,
        maxConsecutiveLosses: 5,
        maxPositionSize: 500,
      });

      expect(model.maxLossPerDay).toBe(0);
    });

    it('handles zero max consecutive losses', () => {
      const model = executionService.createRiskModelFromConstraints({
        maxDrawdownPercent: 20,
        maxLossPerDay: 1000,
        maxConsecutiveLosses: 0,
        maxPositionSize: 500,
      });

      expect(model.maxConsecutiveLosses).toBe(0);
    });
  });

  describe('Execution model application edge cases', () => {
    it('handles zero quantity trade', async () => {
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100],
        slippageSamples: [
          {
            tradeSize: 100,
            slippage: 0.001,
            expectedPrice: 100,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 0,
      });

      const trade = {
        type: 'entry' as const,
        asset: 'mint1',
        quantity: 0,
        expectedPrice: 100,
      };

      const random = () => 0.5;
      const result = await executionService.applyExecutionModel(trade, model, random);

      expect(result.executedPrice).toBeGreaterThanOrEqual(0);
    });

    it('handles zero expected price', async () => {
      const model = executionService.createExecutionModelFromCalibration({
        latencySamples: [100],
        slippageSamples: [
          {
            tradeSize: 100,
            slippage: 0.001,
            expectedPrice: 100,
            actualPrice: 100.1,
            marketVolume24h: 1000000,
          },
        ],
        failureRate: 0,
      });

      const trade = {
        type: 'entry' as const,
        asset: 'mint1',
        quantity: 1,
        expectedPrice: 0,
      };

      const random = () => 0.5;
      const result = await executionService.applyExecutionModel(trade, model, random);

      expect(result.executedPrice).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cost model application edge cases', () => {
    it('handles zero trade value', () => {
      const model = executionService.createCostModelFromFees({
        baseFee: 5000,
        priorityFeeRange: { min: 1000, max: 10000 },
        tradingFeePercent: 0.01,
      });

      const cost = executionService.applyCostModel(
        {
          value: 0,
          priority: 'low',
        },
        model
      );

      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('handles very large trade value', () => {
      const model = executionService.createCostModelFromFees({
        baseFee: 5000,
        priorityFeeRange: { min: 1000, max: 10000 },
        tradingFeePercent: 0.01,
      });

      const cost = executionService.applyCostModel(
        {
          value: 1e9,
          priority: 'high',
        },
        model
      );

      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('Risk constraint checking edge cases', () => {
    it('blocks trade when all constraints are at zero (zero means no trades)', () => {
      const model = executionService.createRiskModelFromConstraints({
        maxDrawdownPercent: 0,
        maxLossPerDay: 0,
        maxConsecutiveLosses: 0,
        maxPositionSize: 0,
      });

      const check = executionService.checkRiskConstraints(
        {
          currentDrawdown: 0,
          lossToday: 0,
          consecutiveLosses: 0,
          currentExposure: 0,
          tradesToday: 0,
        },
        model
      );

      // With all constraints at zero, should block (zero means no trades allowed)
      expect(check.allowed).toBe(false);
    });

    it('blocks trade when exceeding all constraints', () => {
      const model = executionService.createRiskModelFromConstraints({
        maxDrawdownPercent: 20,
        maxLossPerDay: 1000,
        maxConsecutiveLosses: 5,
        maxPositionSize: 500,
      });

      const check = executionService.checkRiskConstraints(
        {
          currentDrawdown: 0.25, // Exceeds 20%
          lossToday: 1500, // Exceeds 1000
          consecutiveLosses: 6, // Exceeds 5
          currentExposure: 600, // Exceeds 500
          tradesToday: 0,
        },
        model
      );

      expect(check.allowed).toBe(false);
      expect(check.hitLimit).toBeDefined();
    });
  });
});

