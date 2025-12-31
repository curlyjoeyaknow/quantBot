/**
 * Integration tests for full simulation workflow
 *
 * Tests the complete flow: plan → preflight → slice → simulate → persist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { runSimulation } from '../../../src/simulation/runSimulation.js';
import type { SimulationRunSpec, WorkflowContext } from '../../../src/types.js';
import type { StrategyConfig } from '@quantbot/simulation/src/engine/index.js';

// Mock dependencies
vi.mock('@quantbot/ohlcv', () => ({
  getCoverage: vi.fn(),
}));

vi.mock('@quantbot/storage', () => ({
  getStorageEngine: vi.fn(),
}));

vi.mock('@quantbot/core', () => ({
  getArtifactsDir: vi.fn(() => '/tmp/artifacts'),
}));

describe('runSimulation Integration', () => {
  const mockStrategyConfig: StrategyConfig = {
    entry: { mode: 'immediate' },
    exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
    stops: { stop_loss_pct: 5 },
    execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
  };

  const mockCtx: WorkflowContext = {
    clock: { nowISO: () => DateTime.utc().toISO()! },
    ids: { newRunId: () => 'test-run-123' },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    repos: {
      strategies: {
        getByName: vi.fn().mockResolvedValue({
          id: 'strat1',
          name: 'TestStrategy',
          config: mockStrategyConfig,
        }),
      },
      calls: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'call1',
            caller: 'test',
            mint: 'token1',
            createdAt: DateTime.fromISO('2024-01-01T12:00:00Z'),
          },
        ]),
      },
      simulationRuns: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      simulationResults: {
        insertMany: vi.fn().mockResolvedValue(undefined),
      },
    },
    ohlcv: {
      causalAccessor: {} as any,
    },
    simulation: {
      run: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute full workflow with eligible tokens', async () => {
    const { getCoverage } = await import('@quantbot/ohlcv');
    const { getStorageEngine } = await import('@quantbot/storage');

    // Mock coverage check - token is eligible
    vi.mocked(getCoverage).mockResolvedValue({
      hasData: true,
      candleCount: 500,
      coverageRatio: 0.95,
      gaps: [],
    });

    // Mock storage engine - return candles
    const mockCandles = [
      {
        timestamp: Math.floor(DateTime.fromISO('2024-01-01T11:00:00Z').toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.0,
        volume: 1000,
      },
      {
        timestamp: Math.floor(DateTime.fromISO('2024-01-01T11:05:00Z').toSeconds()),
        open: 1.0,
        high: 1.2,
        low: 0.95,
        close: 1.1,
        volume: 1200,
      },
    ];

    vi.mocked(getStorageEngine).mockReturnValue({
      getCandles: vi.fn().mockResolvedValue(mockCandles),
    } as any);

    const spec: SimulationRunSpec = {
      strategyName: 'TestStrategy',
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      options: {
        dryRun: false,
        preWindowMinutes: 60,
        postWindowMinutes: 120,
      },
    };

    const result = await runSimulation(spec, mockCtx);

    expect(result.runId).toBe('test-run-123');
    expect(result.strategyName).toBe('TestStrategy');
    expect(result.totals.callsFound).toBe(1);
    expect(mockCtx.repos.simulationRuns.create).toHaveBeenCalled();
    expect(mockCtx.repos.simulationResults.insertMany).toHaveBeenCalled();
  });

  it('should handle dry run mode', async () => {
    const { getCoverage } = await import('@quantbot/ohlcv');
    const { getStorageEngine } = await import('@quantbot/storage');

    vi.mocked(getCoverage).mockResolvedValue({
      hasData: true,
      candleCount: 500,
      coverageRatio: 0.95,
      gaps: [],
    });

    vi.mocked(getStorageEngine).mockReturnValue({
      getCandles: vi.fn().mockResolvedValue([]),
    } as any);

    const spec: SimulationRunSpec = {
      strategyName: 'TestStrategy',
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      options: {
        dryRun: true,
      },
    };

    const result = await runSimulation(spec, mockCtx);

    expect(result.dryRun).toBe(true);
    // Should not persist in dry run
    expect(mockCtx.repos.simulationRuns.create).not.toHaveBeenCalled();
  });

  it('should handle no eligible tokens', async () => {
    const { getCoverage } = await import('@quantbot/ohlcv');

    // Mock coverage check - no eligible tokens
    vi.mocked(getCoverage).mockResolvedValue({
      hasData: false,
      candleCount: 0,
      coverageRatio: 0,
      gaps: [],
    });

    const spec: SimulationRunSpec = {
      strategyName: 'TestStrategy',
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
    };

    await expect(runSimulation(spec, mockCtx)).rejects.toThrow('No eligible tokens');
  });

  it('should handle partial universe (some tokens excluded)', async () => {
    const { getCoverage } = await import('@quantbot/ohlcv');
    const { getStorageEngine } = await import('@quantbot/storage');

    // Mock coverage - first token eligible, second excluded
    vi.mocked(getCoverage)
      .mockResolvedValueOnce({
        hasData: true,
        candleCount: 500,
        coverageRatio: 0.95,
        gaps: [],
      })
      .mockResolvedValueOnce({
        hasData: false,
        candleCount: 0,
        coverageRatio: 0,
        gaps: [],
      });

    vi.mocked(getStorageEngine).mockReturnValue({
      getCandles: vi.fn().mockResolvedValue([
        {
          timestamp: Math.floor(DateTime.fromISO('2024-01-01T11:00:00Z').toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.0,
          volume: 1000,
        },
      ]),
    } as any);

    const mockCtxWithTwoCalls = {
      ...mockCtx,
      repos: {
        ...mockCtx.repos,
        calls: {
          list: vi.fn().mockResolvedValue([
            {
              id: 'call1',
              caller: 'test',
              mint: 'token1',
              createdAt: DateTime.fromISO('2024-01-01T12:00:00Z'),
            },
            {
              id: 'call2',
              caller: 'test',
              mint: 'token2',
              createdAt: DateTime.fromISO('2024-01-01T13:00:00Z'),
            },
          ]),
        },
      },
    };

    const spec: SimulationRunSpec = {
      strategyName: 'TestStrategy',
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
    };

    const result = await runSimulation(spec, mockCtxWithTwoCalls);

    // Should succeed with only eligible token
    expect(result.totals.callsFound).toBe(2);
    expect(result.totals.callsSucceeded).toBeGreaterThan(0);
  });
});
