/**
 * Integration Test: Simulations Reject Live Data
 * ==============================================
 *
 * CRITICAL: This test verifies that simulations only accept snapshot refs, not live data.
 *
 * This ensures reproducibility - simulations must use immutable snapshots, not live queries.
 * If this test fails, it means simulations can accept live data, breaking determinism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResearchSimulationAdapter } from '../../../src/research/simulation-adapter.js';
import type { SimulationRequest } from '../../../src/research/contract.js';
import type { WorkflowContext } from '../../../src/types.js';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/utils';
import type { StrategyConfig } from '@quantbot/backtest';

// Mock DataSnapshotService to verify it's called with snapshot ref
const mockLoadSnapshot = vi.fn();
const mockVerifySnapshot = vi.fn();

vi.mock('../../../src/research/services/DataSnapshotService.js', () => ({
  DataSnapshotService: class {
    constructor() {}
    async loadSnapshot(snapshot: any) {
      // Verify snapshot has contentHash (proves it's a snapshot ref, not live data)
      if (!snapshot || !snapshot.contentHash) {
        throw new ValidationError(
          'Simulations must use snapshot refs with contentHash, not live data',
          {
            snapshot,
          }
        );
      }
      return mockLoadSnapshot(snapshot);
    }
    async verifySnapshot(snapshot: any) {
      return mockVerifySnapshot(snapshot);
    }
  },
}));

describe('Snapshot-Only Input Enforcement', () => {
  let adapter: ResearchSimulationAdapter;
  let ctx: WorkflowContext;

  beforeEach(() => {
    ctx = {
      clock: {
        nowISO: () => DateTime.utc().toISO() ?? '2024-01-01T00:00:00.000Z',
      },
      ids: {
        newRunId: () => `run_${Date.now()}`,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      repos: {} as any,
      ohlcv: {} as any,
      simulation: {} as any,
    };

    adapter = new ResearchSimulationAdapter(ctx);
    mockLoadSnapshot.mockClear();
    mockVerifySnapshot.mockClear();
    mockVerifySnapshot.mockResolvedValue(true); // Default to valid snapshot
  });

  it('CRITICAL: rejects simulation request without contentHash (live data)', async () => {
    const strategyConfig: StrategyConfig = {
      name: 'TestStrategy',
      profitTargets: [{ target: 2.0, percent: 1.0 }],
    };

    const request: SimulationRequest = {
      // Missing contentHash - this is live data, not a snapshot
      dataSnapshot: {
        snapshotId: 'live-data',
        // contentHash: missing! This should be rejected
        timeRange: {
          fromISO: '2024-01-01T00:00:00.000Z',
          toISO: '2024-01-01T01:00:00.000Z',
        },
        sources: [{ venue: 'pump.fun' }],
        schemaVersion: '1.0.0',
        createdAtISO: '2024-01-01T00:00:00.000Z',
      } as any, // Type assertion to bypass TypeScript (testing runtime validation)
      strategy: {
        strategyId: 'strategy_1',
        name: 'TestStrategy',
        config: strategyConfig,
        configHash: 'b'.repeat(64),
        schemaVersion: '1.0.0',
      },
      executionModel: {
        latency: { p50: 100, p90: 200, p99: 500, jitter: 10 },
        slippage: { base: 0.001, volumeImpact: 0.0001, max: 0.01 },
      },
      costModel: { tradingFee: 0.001 },
      runConfig: { seed: 12345 },
    };

    // Should reject because contentHash is missing (proves it's not a snapshot)
    await expect(adapter.run(request)).rejects.toThrow();
  });

  it('CRITICAL: accepts simulation request with valid snapshot ref', async () => {
    const strategyConfig: StrategyConfig = {
      name: 'TestStrategy',
      profitTargets: [{ target: 2.0, percent: 1.0 }],
    };

    const request: SimulationRequest = {
      dataSnapshot: {
        snapshotId: 'snapshot_1',
        contentHash: 'a'.repeat(64), // Valid SHA-256 hash
        timeRange: {
          fromISO: '2024-01-01T00:00:00.000Z',
          toISO: '2024-01-01T01:00:00.000Z',
        },
        sources: [{ venue: 'pump.fun' }],
        schemaVersion: '1.0.0',
        createdAtISO: '2024-01-01T00:00:00.000Z',
      },
      strategy: {
        strategyId: 'strategy_1',
        name: 'TestStrategy',
        config: strategyConfig,
        configHash: 'b'.repeat(64),
        schemaVersion: '1.0.0',
      },
      executionModel: {
        latency: { p50: 100, p90: 200, p99: 500, jitter: 10 },
        slippage: { base: 0.001, volumeImpact: 0.0001, max: 0.01 },
      },
      costModel: { tradingFee: 0.001 },
      runConfig: { seed: 12345 },
    };

    mockLoadSnapshot.mockResolvedValue({
      candles: [
        {
          timestamp: 1704067200,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
          mint: 'So11111111111111111111111111111111111111112',
        },
      ],
      calls: [
        {
          id: 'call_1',
          caller: 'test',
          mint: 'So11111111111111111111111111111111111111112',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    // Should accept because contentHash is present (proves it's a snapshot)
    const result = await adapter.run(request);
    expect(result).toBeDefined();
    expect(result.metadata.dataSnapshotHash).toBe(request.dataSnapshot.contentHash);
  });

  it('CRITICAL: verifies snapshot integrity before simulation', async () => {
    const strategyConfig: StrategyConfig = {
      name: 'TestStrategy',
      profitTargets: [{ target: 2.0, percent: 1.0 }],
    };

    const request: SimulationRequest = {
      dataSnapshot: {
        snapshotId: 'snapshot_1',
        contentHash: 'a'.repeat(64),
        timeRange: {
          fromISO: '2024-01-01T00:00:00.000Z',
          toISO: '2024-01-01T01:00:00.000Z',
        },
        sources: [{ venue: 'pump.fun' }],
        schemaVersion: '1.0.0',
        createdAtISO: '2024-01-01T00:00:00.000Z',
      },
      strategy: {
        strategyId: 'strategy_1',
        name: 'TestStrategy',
        config: strategyConfig,
        configHash: 'b'.repeat(64),
        schemaVersion: '1.0.0',
      },
      executionModel: {
        latency: { p50: 100, p90: 200, p99: 500, jitter: 10 },
        slippage: { base: 0.001, volumeImpact: 0.0001, max: 0.01 },
      },
      costModel: { tradingFee: 0.001 },
      runConfig: { seed: 12345 },
    };

    // Mock verifySnapshot to return false (integrity check failed)
    mockVerifySnapshot.mockResolvedValue(false);

    // Should reject because snapshot integrity check failed
    await expect(adapter.run(request)).rejects.toThrow(ValidationError);
  });
});
