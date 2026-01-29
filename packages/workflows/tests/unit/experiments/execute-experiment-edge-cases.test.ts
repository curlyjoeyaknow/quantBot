/**
 * Execute Experiment Handler - Edge Case Tests
 *
 * Tests edge cases and error conditions for experiment execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ArtifactStorePort,
  ProjectionBuilderPort,
  ExperimentTrackerPort,
  ExperimentDefinition,
  ArtifactManifestRecord,
} from '@quantbot/core';
import type { SimulationService } from '@quantbot/simulation';

// Mock the simulation executor module
vi.mock('../../../src/experiments/simulation-executor.js', () => ({
  executeSimulation: vi.fn().mockResolvedValue({
    tradesPath: '/tmp/trades.parquet',
    metricsPath: '/tmp/metrics.parquet',
    curvesPath: '/tmp/curves.parquet',
    diagnosticsPath: '/tmp/diagnostics.parquet',
    inputArtifactIds: [],
  }),
}));

import {
  executeExperiment,
  type ExperimentExecutionPorts,
} from '../../../src/experiments/index.js';

describe('executeExperiment - Edge Cases', () => {
  let mockArtifactStore: ArtifactStorePort;
  let mockProjectionBuilder: ProjectionBuilderPort;
  let mockExperimentTracker: ExperimentTrackerPort;
  let mockSimulationService: SimulationService;
  let ports: ExperimentExecutionPorts;

  beforeEach(() => {
    mockArtifactStore = {
      getArtifact: vi.fn().mockResolvedValue({
        artifactId: 'test-artifact-1',
        status: 'active',
        artifactType: 'alerts_v1',
        schemaVersion: 1,
        logicalKey: 'test-key',
        pathParquet: '/path/to/artifact.parquet',
        pathSidecar: '/path/to/artifact.json',
        fileHash: 'hash123',
        contentHash: 'content123',
        rowCount: 100,
        createdAt: new Date().toISOString(),
      } as ArtifactManifestRecord),
      listArtifacts: vi.fn(),
      findByLogicalKey: vi.fn(),
      publishArtifact: vi.fn().mockResolvedValue({
        success: true,
        deduped: false,
        artifactId: 'output-artifact-1',
        pathParquet: '/path/to/output.parquet',
        pathSidecar: '/path/to/output.json',
      }),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
      supersede: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    mockProjectionBuilder = {
      buildProjection: vi.fn().mockResolvedValue({
        projectionId: 'test-projection',
        duckdbPath: '/tmp/test-projection.duckdb',
        tables: [
          { name: 'alerts', rowCount: 10, columns: ['id', 'timestamp'], indexes: [] },
          {
            name: 'ohlcv',
            rowCount: 1000,
            columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
            indexes: [],
          },
        ],
        artifactCount: 2,
        totalRows: 1010,
      }),
      rebuildProjection: vi.fn(),
      disposeProjection: vi.fn().mockResolvedValue(undefined),
      projectionExists: vi.fn().mockResolvedValue(true),
      getProjectionMetadata: vi.fn().mockResolvedValue(null),
      listProjections: vi.fn().mockResolvedValue([]),
      getProjectionLineage: vi.fn().mockResolvedValue(null),
      getMetrics: vi.fn().mockResolvedValue({
        totalProjections: 0,
        totalRows: 0,
        totalSizeBytes: 0,
        averageBuildTimeMs: 0,
      }),
      cleanupOldProjections: vi.fn().mockResolvedValue(0),
      cleanupFailedBuilds: vi.fn().mockResolvedValue(0),
    };

    mockExperimentTracker = {
      createExperiment: vi.fn().mockResolvedValue({
        experimentId: 'test-exp-123',
        name: 'Test Experiment',
        status: 'pending',
        inputs: { alerts: ['alert-1'], ohlcv: ['ohlcv-1'] },
        config: {
          strategy: {
            name: 'momentum',
            exit: { targets: [{ target: 2, percent: 1.0 }] },
          },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: new Date().toISOString(),
        },
      }),
      getExperiment: vi.fn().mockResolvedValue({
        experimentId: 'test-exp-123',
        status: 'completed',
        outputs: {
          trades: 'trades-artifact-1',
          metrics: 'metrics-artifact-1',
          curves: 'curves-artifact-1',
        },
      }),
      listExperiments: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      storeResults: vi.fn().mockResolvedValue(undefined),
      findByInputArtifacts: vi.fn(),
    };

    // Create mock simulation service
    mockSimulationService = {
      runSimulation: vi.fn().mockResolvedValue({
        results: [],
        summary: {
          total_runs: 0,
          successful: 0,
          failed: 0,
        },
      }),
    } as unknown as SimulationService;

    ports = {
      artifactStore: mockArtifactStore,
      projectionBuilder: mockProjectionBuilder,
      experimentTracker: mockExperimentTracker,
      simulationService: mockSimulationService,
    };
  });

  it('should handle empty experiment (no alerts)', async () => {
    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-empty',
      name: 'Empty Experiment',
      inputs: {
        alerts: [],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    // Should fail validation (no alerts)
    await expect(executeExperiment(definition, ports)).rejects.toThrow();
  });

  it('should handle invalid date range (from > to)', async () => {
    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-invalid-dates',
      name: 'Invalid Date Range',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-31', to: '2025-01-01' }, // Invalid: from > to
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    await expect(executeExperiment(definition, ports)).rejects.toThrow();
  });

  it('should handle missing exit targets', async () => {
    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-no-targets',
      name: 'No Exit Targets',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: {}, // No targets
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    await expect(executeExperiment(definition, ports)).rejects.toThrow('Exit targets are required');
  });

  it('should handle projection build retry on transient failure', async () => {
    let attemptCount = 0;
    mockProjectionBuilder.buildProjection = vi.fn().mockImplementation(async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('Database lock timeout');
      }
      return {
        projectionId: 'test-projection',
        duckdbPath: '/tmp/test-projection.duckdb',
        tables: [],
        artifactCount: 2,
        totalRows: 1010,
      };
    });

    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-retry',
      name: 'Retry Test',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    // Should succeed after retry
    await executeExperiment(definition, ports);
    expect(mockProjectionBuilder.buildProjection).toHaveBeenCalledTimes(2);
  });

  it('should handle projection build failure after retries', async () => {
    mockProjectionBuilder.buildProjection = vi
      .fn()
      .mockRejectedValue(new Error('Database lock timeout'));

    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-retry-fail',
      name: 'Retry Fail Test',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    await expect(executeExperiment(definition, ports)).rejects.toThrow();
    expect(mockProjectionBuilder.buildProjection).toHaveBeenCalledTimes(3); // 3 retries
  });

  it('should handle partial artifact publishing failure', async () => {
    let publishCount = 0;
    mockArtifactStore.publishArtifact = vi.fn().mockImplementation(async () => {
      publishCount++;
      if (publishCount === 2) {
        // Fail on metrics artifact
        return {
          success: false,
          error: 'Failed to publish metrics artifact',
        };
      }
      return {
        success: true,
        deduped: false,
        artifactId: `artifact-${publishCount}`,
        pathParquet: `/path/to/artifact-${publishCount}.parquet`,
        pathSidecar: `/path/to/artifact-${publishCount}.json`,
      };
    });

    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-partial-fail',
      name: 'Partial Fail Test',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    await expect(executeExperiment(definition, ports)).rejects.toThrow(
      'Failed to publish metrics artifact'
    );
  });

  it('should handle very long experiment ID', async () => {
    const longId = 'a'.repeat(300); // Very long ID
    const definition: ExperimentDefinition = {
      experimentId: longId,
      name: 'Long ID Test',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    // Should handle long IDs (may fail validation or succeed depending on implementation)
    await expect(executeExperiment(definition, ports)).resolves.toBeDefined();
  });

  it('should handle unicode characters in experiment name', async () => {
    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-unicode',
      name: 'Test Experiment 🚀 测试 実験',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    await expect(executeExperiment(definition, ports)).resolves.toBeDefined();
  });

  it('should handle cleanup failure gracefully', async () => {
    mockProjectionBuilder.disposeProjection = vi
      .fn()
      .mockRejectedValue(new Error('Cleanup failed'));

    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-cleanup-fail',
      name: 'Cleanup Fail Test',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: { targets: [{ target: 2, percent: 1.0 }] },
        },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    // Should complete successfully despite cleanup failure
    await expect(executeExperiment(definition, ports)).resolves.toBeDefined();
  });
});

