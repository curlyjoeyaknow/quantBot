/**
 * Full integration test: Branch A + Branch B + Branch C
 *
 * This test demonstrates how all three branches work together.
 * It uses mocks for Branch B and C since they don't exist yet.
 */

import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSingleSimulation, type SimulationRequest } from '../../../src/research/index.js';
import { createExperimentContext } from '../../../src/research/context.js';
import { createProductionContext } from '../../../src/context/createProductionContext.js';
import { createHash } from 'crypto';

/**
 * Mock Branch B: Data Snapshot Service
 */
class MockDataSnapshotService {
  createSnapshot(params: {
    timeRange: { fromISO: string; toISO: string };
    sources: Array<{ venue: string; chain?: string }>;
  }) {
    const snapshotData = {
      timeRange: params.timeRange,
      sources: params.sources,
    };

    const contentHash = createHash('sha256').update(JSON.stringify(snapshotData)).digest('hex');

    return {
      snapshotId: `snapshot-${Date.now()}`,
      contentHash,
      timeRange: params.timeRange,
      sources: params.sources,
      schemaVersion: '1.0.0',
      createdAtISO: new Date().toISOString(),
    };
  }
}

/**
 * Mock Branch C: Execution/Cost/Risk Model Service
 */
class MockExecutionRealityService {
  createExecutionModel() {
    return {
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
      },
      partialFills: {
        probability: 0.1,
        fillRange: [0.5, 0.9] as [number, number],
      },
    };
  }

  createCostModel() {
    return {
      baseFee: 5000,
      priorityFee: {
        base: 1000,
        max: 10000,
      },
      tradingFee: 0.01,
      effectiveCostPerTrade: 6000,
    };
  }

  createRiskModel() {
    return {
      maxDrawdown: 0.2,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
      maxTotalExposure: 10000,
    };
  }
}

describe('Full Integration: Branch A + B + C', () => {
  const mockDataService = new MockDataSnapshotService();
  const mockExecutionService = new MockExecutionRealityService();

  it('runs complete simulation with all branches integrated', async () => {
    // Branch B: Create data snapshot
    const snapshot = mockDataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun', chain: 'solana' }],
    });

    // Branch C: Create execution/cost/risk models
    const executionModel = mockExecutionService.createExecutionModel();
    const costModel = mockExecutionService.createCostModel();
    const riskModel = mockExecutionService.createRiskModel();

    // Branch A: Create simulation request
    const request: SimulationRequest = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test-strategy',
        config: {
          targets: [{ target: 2, percent: 0.5 }],
        },
        configHash: createHash('sha256')
          .update(JSON.stringify({ targets: [{ target: 2, percent: 0.5 }] }))
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

  it('verifies all branch interfaces are compatible', () => {
    // Branch B interface
    const snapshot = mockDataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    // Branch C interfaces
    const executionModel = mockExecutionService.createExecutionModel();
    const costModel = mockExecutionService.createCostModel();
    const riskModel = mockExecutionService.createRiskModel();

    // Branch A: All interfaces work together
    const request: SimulationRequest = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test',
        config: {},
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
    const snapshot = mockDataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    const request: SimulationRequest = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test',
        config: {},
        configHash: 'a'.repeat(64),
      },
      executionModel: mockExecutionService.createExecutionModel(),
      costModel: mockExecutionService.createCostModel(),
      riskModel: mockExecutionService.createRiskModel(),
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
