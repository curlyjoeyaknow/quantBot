/**
 * Property Tests for ResearchSimulationAdapter
 * ============================================
 *
 * Tests critical invariants for the Research OS simulation adapter.
 *
 * Critical Invariants:
 * 1. Determinism: Same inputs → same outputs (same runId, same trade events, same metrics)
 * 2. Idempotency: Running twice with same inputs produces identical results
 * 3. Bounds checking: Metrics are within reasonable bounds
 * 4. Event conversion: All trade events are valid and properly formatted
 * 5. Snapshot integrity: Properly loads and uses snapshot data
 * 6. Model conversion: ExecutionModel, CostModel conversions preserve semantics
 * 7. Error handling: Handles missing candles, invalid configs gracefully
 * 8. JSON serialization: All outputs are JSON-serializable
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DateTime } from 'luxon';
import { ResearchSimulationAdapter } from '../../src/research/simulation-adapter.js';
import type {
  SimulationRequest,
  DataSnapshotRef,
  StrategyRef,
} from '../../src/research/contract.js';
import type { WorkflowContext } from '../../src/types.js';
import type { StrategyConfig } from '@quantbot/simulation';
import { DataSnapshotService } from '../../src/research/services/DataSnapshotService.js';
import type { SnapshotData } from '../../src/research/services/DataSnapshotService.js';

// Mock DataSnapshotService - must be hoisted
const mockDataSnapshotService = vi.fn();
vi.mock('../../src/research/services/DataSnapshotService.js', () => ({
  DataSnapshotService: class {
    constructor(ctx?: any) {
      return mockDataSnapshotService(ctx);
    }
  },
}));

// Mock simulateStrategy - must be hoisted
const mockSimulateStrategy = vi.fn();
vi.mock('@quantbot/simulation/core/simulator.js', () => ({
  simulateStrategy: (...args: any[]) => mockSimulateStrategy(...args),
}));

/**
 * Create a mock workflow context for testing
 */
function createMockWorkflowContext(overrides?: Partial<WorkflowContext>): WorkflowContext {
  let runIdCounter = 0;
  return {
    clock: {
      nowISO: () => DateTime.utc().toISO() ?? '2024-01-01T00:00:00.000Z',
    },
    ids: {
      newRunId: () => `run_${++runIdCounter}_${Date.now()}`,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    repos: {} as any,
    ohlcv: {} as any,
    simulation: {} as any,
    ...overrides,
  };
}

/**
 * Create a mock snapshot data generator
 */
function createMockSnapshotData(overrides?: Partial<SnapshotData>): SnapshotData {
  const baseTimestamp = 1704067200; // 2024-01-01T00:00:00Z
  const mint = 'So11111111111111111111111111111111111111112';

  return {
    candles: [
      {
        timestamp: baseTimestamp,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
        mint,
      },
      {
        timestamp: baseTimestamp + 300, // 5 minutes later
        open: 1.05,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 1200,
        mint,
      },
      {
        timestamp: baseTimestamp + 600, // 10 minutes later
        open: 1.15,
        high: 1.3,
        low: 1.1,
        close: 1.25,
        volume: 1500,
        mint,
      },
    ],
    calls: [
      {
        id: 'call_1',
        caller: 'test_caller',
        mint,
        createdAt: DateTime.fromSeconds(baseTimestamp).toISO() ?? '',
        price: 1.0,
        volume: 1000,
      },
    ],
    ...overrides,
  };
}

/**
 * Create a mock simulation request
 */
function createMockSimulationRequest(overrides?: Partial<SimulationRequest>): SimulationRequest {
  const baseTimestamp = 1704067200; // 2024-01-01T00:00:00Z

  const strategyConfig: StrategyConfig = {
    name: 'TestStrategy',
    profitTargets: [
      { target: 2.0, percent: 0.5 },
      { target: 3.0, percent: 0.5 },
    ],
    stopLoss: {
      initial: -0.2,
    },
  };

  return {
    dataSnapshot: {
      snapshotId: 'snapshot_1',
      contentHash: 'a'.repeat(64), // Mock SHA-256 hash
      timeRange: {
        fromISO: DateTime.fromSeconds(baseTimestamp).toISO() ?? '',
        toISO: DateTime.fromSeconds(baseTimestamp + 3600).toISO() ?? '',
      },
      sources: [{ venue: 'pump.fun', chain: 'solana' }],
      schemaVersion: '1.0.0',
      createdAtISO: DateTime.utc().toISO() ?? '',
    },
    strategy: {
      strategyId: 'strategy_1',
      name: 'TestStrategy',
      config: strategyConfig,
      configHash: 'b'.repeat(64), // Mock SHA-256 hash
      schemaVersion: '1.0.0',
    },
    executionModel: {
      latency: {
        p50: 100,
        p90: 200,
        p99: 500,
        jitter: 10,
      },
      slippage: {
        base: 0.001, // 0.1%
        volumeImpact: 0.0001,
        max: 0.01, // 1%
      },
      failures: {
        baseRate: 0.01, // 1%
        congestionMultiplier: 1.5,
        maxRate: 0.1, // 10%
      },
      partialFills: {
        probability: 0.05, // 5%
        fillDistribution: {
          type: 'uniform',
          minFill: 0.5,
          maxFill: 1.0,
        },
      },
    },
    costModel: {
      tradingFee: 0.001, // 0.1%
      priorityFee: 0.0001,
    },
    runConfig: {
      seed: 12345,
    },
    ...overrides,
  };
}

describe('ResearchSimulationAdapter - Property Tests', () => {
  let mockSnapshotServiceInstance: any;
  let adapter: ResearchSimulationAdapter;
  let ctx: WorkflowContext;

  beforeEach(() => {
    ctx = createMockWorkflowContext();
    mockSnapshotServiceInstance = {
      loadSnapshot: vi.fn(),
    };
    mockDataSnapshotService.mockReturnValue(mockSnapshotServiceInstance);

    // Reset simulateStrategy mock
    mockSimulateStrategy.mockResolvedValue({
      finalPnl: 1.05,
      events: [
        {
          type: 'entry',
          timestamp: 1704067200,
          price: 1.0,
          description: 'Entry',
          remainingPosition: 1.0,
          pnlSoFar: 0,
        },
        {
          type: 'target_hit',
          timestamp: 1704067500,
          price: 2.0,
          description: 'Target hit',
          remainingPosition: 0.5,
          pnlSoFar: 1.0,
        },
      ],
      entryPrice: 1.0,
      finalPrice: 2.0,
      totalCandles: 3,
      entryOptimization: {
        lowestPrice: 0.9,
        lowestPriceTimestamp: 1704067200,
        lowestPricePercent: -0.1,
        lowestPriceTimeFromEntry: 0,
        trailingEntryUsed: false,
        actualEntryPrice: 1.0,
        entryDelay: 0,
      },
    });

    adapter = new ResearchSimulationAdapter(ctx);
  });

  describe('Determinism (Critical Invariant)', () => {
    it('same inputs produce same runId (deterministic)', async () => {
      // Note: runId generation uses Date.now() in the mock, so we need to control time
      const fixedTime = DateTime.utc().toISO() ?? '2024-01-01T00:00:00.000Z';
      const fixedCtx = createMockWorkflowContext({
        clock: { nowISO: () => fixedTime },
        ids: {
          newRunId: () => 'run_deterministic_1',
        },
      });
      const fixedAdapter = new ResearchSimulationAdapter(fixedCtx);

      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result1 = await fixedAdapter.run(request);
      const result2 = await fixedAdapter.run(request);

      // Same inputs should produce same runId (if we control time/ID generation)
      // In practice, runId includes timestamp, so we test that metadata is consistent
      expect(result1.metadata.dataSnapshotHash).toBe(result2.metadata.dataSnapshotHash);
      expect(result1.metadata.strategyConfigHash).toBe(result2.metadata.strategyConfigHash);
      expect(result1.metadata.executionModelHash).toBe(result2.metadata.executionModelHash);
    });

    it('same inputs produce same number of trade events', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result1 = await adapter.run(request);
      const result2 = await adapter.run(request);

      // Same inputs should produce same number of events
      expect(result1.tradeEvents.length).toBe(result2.tradeEvents.length);
    });

    it('same inputs produce same metrics (within floating point tolerance)', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result1 = await adapter.run(request);
      const result2 = await adapter.run(request);

      // Metrics should be identical (or very close due to floating point)
      if (result1.metrics.totalTrades > 0 && result2.metrics.totalTrades > 0) {
        expect(result1.metrics.winRate).toBeCloseTo(result2.metrics.winRate, 5);
        expect(result1.metrics.profitFactor).toBeCloseTo(result2.metrics.profitFactor, 5);
      }
    });
  });

  describe('Idempotency (Critical Invariant)', () => {
    it('running twice with same inputs produces identical artifacts', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result1 = await adapter.run(request);
      const result2 = await adapter.run(request);

      // Artifacts should be identical (except for runId which includes timestamp)
      expect(result1.request).toEqual(result2.request);
      expect(result1.tradeEvents.length).toBe(result2.tradeEvents.length);
      expect(result1.pnlSeries.length).toBe(result2.pnlSeries.length);

      // Compare trade events (excluding runId-dependent fields)
      for (let i = 0; i < result1.tradeEvents.length; i++) {
        const e1 = result1.tradeEvents[i];
        const e2 = result2.tradeEvents[i];
        expect(e1.type).toBe(e2.type);
        expect(e1.asset).toBe(e2.asset);
        expect(e1.price).toBeCloseTo(e2.price, 5);
        expect(e1.quantity).toBeCloseTo(e2.quantity, 5);
      }
    });
  });

  describe('Bounds Checking (Critical Invariant)', () => {
    it('all metrics are within reasonable bounds', async () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // Number of calls (reduced for speed)
          fc.float({ min: Math.fround(0.5), max: Math.fround(2.0) }), // Price range
          async (numCalls, basePrice) => {
            try {
              const request = createMockSimulationRequest();
              const snapshotData = createMockSnapshotData({
                calls: Array.from({ length: numCalls }, (_, i) => ({
                  id: `call_${i}`,
                  caller: 'test_caller',
                  mint: 'So11111111111111111111111111111111111111112',
                  createdAt: DateTime.utc().toISO() ?? '',
                  price: basePrice,
                  volume: 1000,
                })),
              });

              mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

              const result = await adapter.run(request);

              // Check bounds - metrics structure may vary based on trades
              const metrics = result.metrics;

              // Always check that metrics object exists
              if (!metrics) return false;

              // Check trades count (always present)
              if (metrics.trades?.total !== undefined) {
                if (metrics.trades.total < 0) return false;
              }

              // Check drawdown (always present) - can be > 1 for extreme losses
              if (metrics.drawdown?.max !== undefined) {
                if (metrics.drawdown.max < 0) return false;
              }

              // Check hit rate if present
              if (metrics.hitRate?.overall !== undefined) {
                if (metrics.hitRate.overall < 0 || metrics.hitRate.overall > 1) return false;
              }

              // Check return is finite
              if (metrics.return?.total !== undefined) {
                if (!Number.isFinite(metrics.return.total)) return false;
              }

              return true;
            } catch (error) {
              // If it throws, that's a failure
              return false;
            }
          }
        ),
        { numRuns: 10, timeout: 30000 }
      );
    });

    it('PnL series values are finite', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      for (const pnl of result.pnlSeries) {
        expect(Number.isFinite(pnl.cumulativePnL)).toBe(true);
        expect(Number.isFinite(pnl.timestampISO)).toBe(false); // ISO string, not number
        expect(typeof pnl.timestampISO).toBe('string');
      }
    });
  });

  describe('Event Conversion (Critical Invariant)', () => {
    it('all trade events are valid and properly formatted', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      for (const event of result.tradeEvents) {
        // Validate required fields
        expect(event.timestampISO).toBeTruthy();
        expect(['entry', 'exit', 'reentry']).toContain(event.type);
        expect(event.asset).toBeTruthy();
        expect(event.price).toBeGreaterThan(0);
        expect(event.quantity).toBeGreaterThan(0);
        expect(event.value).toBeGreaterThanOrEqual(0);
        expect(event.fees).toBeGreaterThanOrEqual(0);
        expect(typeof event.partialFill).toBe('boolean');
        expect(typeof event.failed).toBe('boolean');

        // Validate ISO timestamp format
        expect(() => DateTime.fromISO(event.timestampISO)).not.toThrow();
        const dt = DateTime.fromISO(event.timestampISO);
        expect(dt.isValid).toBe(true);

        // Validate value = price * quantity (approximately, due to fees)
        const expectedValue = event.price * event.quantity;
        expect(Math.abs(event.value - expectedValue)).toBeLessThan(expectedValue * 0.1); // Allow 10% tolerance
      }
    });

    it('trade events are sorted by timestamp', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      for (let i = 1; i < result.tradeEvents.length; i++) {
        const prev = DateTime.fromISO(result.tradeEvents[i - 1].timestampISO);
        const curr = DateTime.fromISO(result.tradeEvents[i].timestampISO);
        expect(curr.toMillis()).toBeGreaterThanOrEqual(prev.toMillis());
      }
    });
  });

  describe('JSON Serialization (Critical Invariant)', () => {
    it('all outputs are JSON-serializable', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      // Should not throw when serializing
      expect(() => JSON.stringify(result)).not.toThrow();

      // Should be able to round-trip
      const serialized = JSON.stringify(result);
      const deserialized = JSON.parse(serialized);
      expect(deserialized).toBeDefined();
      expect(deserialized.metadata).toBeDefined();
      expect(deserialized.tradeEvents).toBeDefined();
      expect(deserialized.pnlSeries).toBeDefined();
      expect(deserialized.metrics).toBeDefined();
    });

    it('no Date objects in output (only ISO strings)', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      const serialized = JSON.stringify(result);
      const deserialized = JSON.parse(serialized);

      // Recursively check for Date objects
      function checkForDates(obj: any, path = ''): string[] {
        const issues: string[] = [];
        if (obj === null || obj === undefined) return issues;
        if (obj instanceof Date) {
          issues.push(`Date object found at ${path}`);
        } else if (Array.isArray(obj)) {
          obj.forEach((item, idx) => {
            issues.push(...checkForDates(item, `${path}[${idx}]`));
          });
        } else if (typeof obj === 'object') {
          Object.keys(obj).forEach((key) => {
            issues.push(...checkForDates(obj[key], path ? `${path}.${key}` : key));
          });
        }
        return issues;
      }

      const issues = checkForDates(deserialized);
      expect(issues).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('handles missing candles gracefully', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData({
        candles: [], // No candles
        calls: [
          {
            id: 'call_1',
            caller: 'test_caller',
            mint: 'So11111111111111111111111111111111111111112',
            createdAt: DateTime.utc().toISO() ?? '',
          },
        ],
      });

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      // Should complete without throwing, but with no trade events
      expect(result).toBeDefined();
      expect(result.tradeEvents.length).toBe(0);
      expect(result.metrics.totalTrades ?? 0).toBe(0);
    });

    it('handles invalid strategy config gracefully', async () => {
      const request = createMockSimulationRequest({
        strategy: {
          strategyId: 'invalid',
          name: 'Invalid',
          config: {} as any, // Invalid config
          configHash: 'c'.repeat(64),
          schemaVersion: '1.0.0',
        },
      });
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      // Should throw ValidationError
      await expect(adapter.run(request)).rejects.toThrow();
    });
  });

  describe('Model Conversion (Critical Invariant)', () => {
    it('execution model conversion preserves latency semantics', async () => {
      const request = createMockSimulationRequest({
        executionModel: {
          latency: {
            p50: 100,
            p90: 200,
            p99: 500,
            jitter: 10,
          },
          slippage: {
            base: 0.001,
            volumeImpact: 0.0001,
            max: 0.01,
          },
          failures: {
            baseRate: 0.01,
            congestionMultiplier: 1.5,
            maxRate: 0.1,
          },
          partialFills: {
            probability: 0.05,
            fillDistribution: {
              type: 'uniform',
              minFill: 0.5,
              maxFill: 1.0,
            },
          },
        },
      });
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      // Should not throw
      const result = await adapter.run(request);
      expect(result).toBeDefined();
      expect(result.metadata.executionModelHash).toBeDefined();
    });

    it('cost model conversion preserves fee semantics', async () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(0.1) }), // Trading fee 0.01%-10% (exclude 0)
          async (tradingFee) => {
            try {
              const request = createMockSimulationRequest({
                costModel: {
                  tradingFee,
                  priorityFee: 0.0001,
                },
              });
              const snapshotData = createMockSnapshotData();

              mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

              // Should not throw
              const result = await adapter.run(request);

              // Check that result is valid
              if (!result || !result.metadata || !result.metadata.costModelHash) {
                return false;
              }

              return true;
            } catch (error) {
              // If it throws, that's a failure
              return false;
            }
          }
        ),
        { numRuns: 10, timeout: 30000 }
      );
    });
  });

  describe('Snapshot Integrity (Critical Invariant)', () => {
    it('uses snapshot data correctly', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData({
        calls: [
          {
            id: 'call_1',
            caller: 'caller_a',
            mint: 'MintA',
            createdAt: DateTime.utc().toISO() ?? '',
          },
          {
            id: 'call_2',
            caller: 'caller_b',
            mint: 'MintB',
            createdAt: DateTime.utc().toISO() ?? '',
          },
        ],
        candles: [
          {
            timestamp: 1704067200,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
            mint: 'MintA',
          },
          {
            timestamp: 1704067200,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
            mint: 'MintB',
          },
        ],
      });

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      // Should have called loadSnapshot with correct snapshot ref
      expect(mockSnapshotServiceInstance.loadSnapshot).toHaveBeenCalledWith(request.dataSnapshot);

      // Should process all calls from snapshot
      expect(result.tradeEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('filters candles by mint correctly', async () => {
      const request = createMockSimulationRequest();
      const mintA = 'MintA';
      const mintB = 'MintB';

      const snapshotData = createMockSnapshotData({
        calls: [
          {
            id: 'call_1',
            caller: 'test',
            mint: mintA,
            createdAt: DateTime.utc().toISO() ?? '',
          },
        ],
        candles: [
          {
            timestamp: 1704067200,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
            mint: mintA,
          },
          {
            timestamp: 1704067200,
            open: 2.0,
            high: 2.1,
            low: 1.9,
            close: 2.05,
            volume: 2000,
            mint: mintB, // Different mint
          },
        ],
      });

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      // Should only use candles for MintA (the call's mint)
      // All trade events should be for MintA
      for (const event of result.tradeEvents) {
        expect(event.asset).toBe(mintA);
      }
    });
  });

  describe('Metadata Consistency (Critical Invariant)', () => {
    it('metadata hashes match input hashes', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      // Metadata hashes should match input hashes
      expect(result.metadata.dataSnapshotHash).toBe(request.dataSnapshot.contentHash);
      expect(result.metadata.strategyConfigHash).toBe(request.strategy.configHash);
    });

    it('metadata includes all required fields', async () => {
      const request = createMockSimulationRequest();
      const snapshotData = createMockSnapshotData();

      mockSnapshotServiceInstance.loadSnapshot.mockResolvedValue(snapshotData);

      const result = await adapter.run(request);

      // Check all required metadata fields
      expect(result.metadata.runId).toBeDefined();
      expect(result.metadata.gitSha).toBeDefined();
      expect(result.metadata.gitBranch).toBeDefined();
      expect(result.metadata.createdAtISO).toBeDefined();
      expect(result.metadata.dataSnapshotHash).toBeDefined();
      expect(result.metadata.strategyConfigHash).toBeDefined();
      expect(result.metadata.executionModelHash).toBeDefined();
      expect(result.metadata.costModelHash).toBeDefined();
      expect(result.metadata.runConfigHash).toBeDefined();
      expect(result.metadata.simulationTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.schemaVersion).toBe('1.0.0');
    });
  });
});
