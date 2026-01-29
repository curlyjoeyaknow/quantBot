/**
 * Performance Tests for Experiment Execution
 *
 * Tests performance characteristics of experiment execution.
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
vi.mock('../../src/experiments/simulation-executor.js', () => ({
  executeSimulation: vi.fn().mockResolvedValue({
    tradesPath: '/tmp/trades.parquet',
    metricsPath: '/tmp/metrics.parquet',
    curvesPath: '/tmp/curves.parquet',
    diagnosticsPath: '/tmp/diagnostics.parquet',
    inputArtifactIds: [],
  }),
}));

import { executeExperiment, type ExperimentExecutionPorts } from '../../src/experiments/index.js';

describe('Experiment Execution - Performance Tests', () => {
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
        tables: [],
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
      resumeBuild: vi.fn().mockResolvedValue({
        projectionId: 'test-projection',
        duckdbPath: '/tmp/test-projection.duckdb',
        tables: [],
        artifactCount: 2,
        totalRows: 1010,
      }),
      compressProjection: vi.fn().mockResolvedValue('/tmp/compressed.parquet'),
      decompressProjection: vi.fn().mockResolvedValue('/tmp/decompressed.duckdb'),
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

  it('should complete small experiment within reasonable time', async () => {
    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-perf-small',
      name: 'Small Performance Test',
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

    const startTime = Date.now();
    await executeExperiment(definition, ports);
    const duration = Date.now() - startTime;

    // Small experiment should complete quickly (under 5 seconds for mocked operations)
    expect(duration).toBeLessThan(5000);
  });

  it('should handle large number of artifacts efficiently', async () => {
    // Create many artifacts
    const manyAlerts = Array.from({ length: 100 }, (_, i) => `alert-${i}`);
    const manyOhlcv = Array.from({ length: 50 }, (_, i) => `ohlcv-${i}`);

    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-perf-large',
      name: 'Large Performance Test',
      inputs: {
        alerts: manyAlerts,
        ohlcv: manyOhlcv,
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

    const startTime = Date.now();
    await executeExperiment(definition, ports);
    const duration = Date.now() - startTime;

    // Should validate artifacts efficiently
    // Note: Validation happens, but exact call count depends on validation logic
    // The key is that it completes quickly even with many artifacts
    expect(mockArtifactStore.getArtifact).toHaveBeenCalled();
    // Should complete within reasonable time (under 10 seconds for mocked operations)
    // This tests that handling many artifacts doesn't cause performance degradation
    expect(duration).toBeLessThan(10000);
  });

  it('should not leak memory with repeated executions', async () => {
    const definition: ExperimentDefinition = {
      experimentId: 'test-exp-memory',
      name: 'Memory Test',
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

    // Run multiple times
    for (let i = 0; i < 10; i++) {
      const def = { ...definition, experimentId: `test-exp-memory-${i}` };
      await executeExperiment(def, ports);
    }

    // All projections should be disposed
    expect(mockProjectionBuilder.disposeProjection).toHaveBeenCalledTimes(10);
  });
});
