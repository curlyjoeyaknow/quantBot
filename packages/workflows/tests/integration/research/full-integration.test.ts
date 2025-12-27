/**
 * Full integration test: Branch A + Branch B + Branch C
 *
 * This test demonstrates how all three branches work together.
 * Uses real services for Branch B and C.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSingleSimulation, type SimulationRequest } from '../../../src/research/index.js';
import { createExperimentContext } from '../../../src/research/context.js';
import { createProductionContext } from '../../../src/context/createProductionContext.js';
import { createHash } from 'crypto';
import { DataSnapshotService } from '../../../src/research/services/DataSnapshotService.js';
import { ExecutionRealityService } from '../../../src/research/services/ExecutionRealityService.js';

// Mock storage to avoid requiring real database connections in tests
vi.mock('@quantbot/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/storage')>();
  return {
    ...actual,
    getStorageEngine: vi.fn(() => ({
      getCandles: vi.fn().mockResolvedValue([
        {
          timestamp: new Date('2024-01-01T00:00:00Z').getTime() / 1000,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ]),
    })),
  };
});

vi.mock('../../../src/calls/queryCallsDuckdb', async () => {
  const actual = await vi.importActual('../../../src/calls/queryCallsDuckdb');
  return {
    ...actual,
    queryCallsDuckdb: vi.fn().mockResolvedValue({
      calls: [
        {
          id: 'call-001',
          caller: 'test-caller',
          mint: 'mint-001',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          price: 100,
          volume: 1000,
        },
      ],
      totalQueried: 1,
      totalReturned: 1,
      fromISO: '2024-01-01T00:00:00Z',
      toISO: '2024-01-02T00:00:00Z',
    }),
  };
});

describe('Full Integration: Branch A + B + C', () => {
  let dataService: DataSnapshotService;
  let executionService: ExecutionRealityService;
  let ctx: ReturnType<typeof createProductionContext>;

  beforeEach(() => {
    ctx = createProductionContext();
    dataService = new DataSnapshotService(ctx);
    executionService = new ExecutionRealityService(ctx);
  });

  it('runs complete simulation with all branches integrated', async () => {
    // Branch B: Create data snapshot
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun', chain: 'solana' }],
    });

    // Branch C: Create execution/cost/risk models
    const executionModel = executionService.createExecutionModelFromCalibration({
      latencySamples: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
      slippageSamples: [
        { tradeSize: 100, slippage: 0.001 },
        { tradeSize: 200, slippage: 0.002 },
      ],
      failureRate: 0.01,
    });
    const costModel = executionService.createCostModelFromFees({
      baseFee: 5000,
      priorityFeeRange: { min: 1000, max: 10000 },
      tradingFeePercent: 0.01,
    });
    const riskModel = executionService.createRiskModelFromConstraints({
      maxDrawdownPercent: 20,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
    });

    // Branch A: Create simulation request
    const request: SimulationRequest = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test-strategy',
        config: {
          name: 'test-strategy',
          profitTargets: [{ target: 2, percent: 0.5 }],
        },
        configHash: createHash('sha256')
          .update(
            JSON.stringify({ name: 'test-strategy', profitTargets: [{ target: 2, percent: 0.5 }] })
          )
          .digest('hex'),
      },
      executionModel,
      costModel,
      riskModel,
      runConfig: {
        seed: 12345,
        timeResolutionMs: 1000,
        errorMode: 'collect',
        includeEventLogs: true,
      },
    };

    // Branch A: Create experiment context
    const testDir = join(tmpdir(), `test-integration-${Date.now()}`);
    const ctx = createExperimentContext({
      artifactBaseDir: testDir,
      workflowContext: createProductionContext(),
    });

    // Branch A: Run simulation
    const artifact = await runSingleSimulation(request, ctx);

    // Verify artifact structure
    expect(artifact.metadata.runId).toBeDefined();
    expect(artifact.metadata.dataSnapshotHash).toBe(snapshot.contentHash);
    expect(artifact.metadata.strategyConfigHash).toBeDefined();
    expect(artifact.metadata.executionModelHash).toBeDefined();
    expect(artifact.metadata.costModelHash).toBeDefined();
    expect(artifact.metadata.riskModelHash).toBeDefined();

    // Verify metrics are present
    expect(artifact.metrics).toBeDefined();
    expect(artifact.metrics.return).toBeDefined();
    expect(artifact.metrics.drawdown).toBeDefined();
    expect(artifact.metrics.hitRate).toBeDefined();
    expect(artifact.metrics.trades).toBeDefined();
    expect(artifact.metrics.tailLoss).toBeDefined();
    expect(artifact.metrics.feeSensitivity).toBeDefined();

    // Verify artifact can be loaded
    const loaded = await ctx.artifacts.load(artifact.metadata.runId);
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.runId).toBe(artifact.metadata.runId);
  });

  it('verifies all branch interfaces are compatible', async () => {
    // Branch B interface
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    // Branch C interfaces
    const executionModel = executionService.createExecutionModelFromCalibration({
      latencySamples: [100, 200, 300],
      slippageSamples: [{ tradeSize: 100, slippage: 0.001 }],
      failureRate: 0.01,
    });
    const costModel = executionService.createCostModelFromFees({
      baseFee: 5000,
      priorityFeeRange: { min: 1000, max: 10000 },
      tradingFeePercent: 0.01,
    });
    const riskModel = executionService.createRiskModelFromConstraints({
      maxDrawdownPercent: 20,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
    });

    // Branch A: All interfaces work together
    const request: SimulationRequest = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test',
        config: {
          name: 'test',
          profitTargets: [{ target: 2.0, percent: 1.0 }],
        },
        configHash: 'a'.repeat(64),
      },
      executionModel,
      costModel,
      riskModel,
      runConfig: {
        seed: 12345,
      },
    };

    // Verify request is valid
    expect(request.dataSnapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(request.executionModel.latency.p50).toBeGreaterThan(0);
    expect(request.costModel.baseFee).toBeGreaterThan(0);
    expect(request.riskModel.maxDrawdown).toBeGreaterThan(0);
    expect(request.runConfig.seed).toBe(12345);
  });

  it('demonstrates replay capability', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    const executionModel = executionService.createExecutionModelFromCalibration({
      latencySamples: [100, 200, 300],
      slippageSamples: [{ tradeSize: 100, slippage: 0.001 }],
      failureRate: 0.01,
    });
    const costModel = executionService.createCostModelFromFees({
      baseFee: 5000,
      priorityFeeRange: { min: 1000, max: 10000 },
      tradingFeePercent: 0.01,
    });
    const riskModel = executionService.createRiskModelFromConstraints({
      maxDrawdownPercent: 20,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
    });

    const request: SimulationRequest = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test',
        config: {
          name: 'test',
          profitTargets: [{ target: 2.0, percent: 1.0 }],
        },
        configHash: 'a'.repeat(64),
      },
      executionModel,
      costModel,
      riskModel,
      runConfig: {
        seed: 12345, // Same seed for determinism
      },
    };

    const testDir = join(tmpdir(), `test-replay-${Date.now()}`);
    const ctx = createExperimentContext({
      artifactBaseDir: testDir,
      workflowContext: createProductionContext(),
    });

    // Run first simulation
    const artifact1 = await runSingleSimulation(request, ctx);
    const runId1 = artifact1.metadata.runId;

    // Replay with same inputs
    const artifact2 = await runSingleSimulation(request, ctx);
    const runId2 = artifact2.metadata.runId;

    // Should produce different run IDs (new runs)
    expect(runId1).not.toBe(runId2);

    // But with same seed, should produce same results (once fully implemented)
    // For now, we just verify the structure is correct
    expect(artifact1.metadata.runConfigHash).toBe(artifact2.metadata.runConfigHash);
    expect(artifact1.metadata.dataSnapshotHash).toBe(artifact2.metadata.dataSnapshotHash);
  });
});
