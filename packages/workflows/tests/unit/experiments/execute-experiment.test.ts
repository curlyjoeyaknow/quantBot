/**
 * Execute Experiment Handler - Unit Tests
 *
 * Tests the pure handler logic with mock ports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ArtifactStorePort,
  ProjectionBuilderPort,
  ExperimentTrackerPort,
  ExperimentDefinition,
  Experiment,
  ArtifactManifestRecord,
  ProjectionResult,
  ExperimentResults,
} from '@quantbot/core';

// Mock the simulation executor module
vi.mock('../../../src/experiments/simulation-executor.js', () => ({
  executeSimulation: vi.fn().mockResolvedValue({
    tradesPath: '/tmp/trades.json',
    metricsPath: '/tmp/metrics.json',
    curvesPath: '/tmp/curves.json',
    inputArtifactIds: [],
  }),
}));

// Import after mocking
import {
  executeExperiment,
  type ExperimentExecutionPorts,
} from '../../../src/experiments/index.js';
import { executeSimulation } from '../../../src/experiments/simulation-executor.js';

describe('executeExperiment', () => {
  let mockArtifactStore: ArtifactStorePort;
  let mockProjectionBuilder: ProjectionBuilderPort;
  let mockExperimentTracker: ExperimentTrackerPort;
  let ports: ExperimentExecutionPorts;
  let testDefinition: ExperimentDefinition;

  beforeEach(() => {
    // Create mock artifact store
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

    // Create mock projection builder
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
      } as ProjectionResult),
      rebuildProjection: vi.fn(),
      disposeProjection: vi.fn().mockResolvedValue(undefined),
      projectionExists: vi.fn().mockResolvedValue(true),
    };

    // Create mock experiment tracker
    const mockExperiment: Experiment = {
      experimentId: 'test-exp-123',
      name: 'Test Experiment',
      description: 'Test description',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: {
            targets: [
              { target: 2, percent: 0.5 },
              { target: 3, percent: 0.5 },
            ],
          },
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
      status: 'pending',
    };

    mockExperimentTracker = {
      createExperiment: vi.fn().mockResolvedValue(mockExperiment),
      getExperiment: vi.fn().mockResolvedValue({
        ...mockExperiment,
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

    ports = {
      artifactStore: mockArtifactStore,
      projectionBuilder: mockProjectionBuilder,
      experimentTracker: mockExperimentTracker,
    };

    testDefinition = {
      experimentId: 'test-exp-123',
      name: 'Test Experiment',
      description: 'Test description',
      inputs: {
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: {
            targets: [
              { target: 2, percent: 0.5 },
              { target: 3, percent: 0.5 },
            ],
          },
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
  });

  it('should create experiment with pending status', async () => {
    await executeExperiment(testDefinition, ports);

    expect(mockExperimentTracker.createExperiment).toHaveBeenCalledWith(testDefinition);
  });

  it('should validate input artifacts before execution', async () => {
    await executeExperiment(testDefinition, ports);

    expect(mockArtifactStore.getArtifact).toHaveBeenCalledWith('alert-1');
    expect(mockArtifactStore.getArtifact).toHaveBeenCalledWith('ohlcv-1');
  });

  it('should throw error if artifact validation fails', async () => {
    mockArtifactStore.getArtifact = vi.fn().mockRejectedValue(new Error('Artifact not found'));

    await expect(executeExperiment(testDefinition, ports)).rejects.toThrow(
      'Artifact validation failed'
    );
  });

  it('should throw error if artifact has invalid status', async () => {
    mockArtifactStore.getArtifact = vi.fn().mockResolvedValue({
      artifactId: 'test-artifact-1',
      status: 'superseded',
      artifactType: 'alerts_v1',
      schemaVersion: 1,
      logicalKey: 'test-key',
      pathParquet: '/path/to/artifact.parquet',
      pathSidecar: '/path/to/artifact.json',
      fileHash: 'hash123',
      contentHash: 'content123',
      rowCount: 100,
      createdAt: new Date().toISOString(),
    } as ArtifactManifestRecord);

    await expect(executeExperiment(testDefinition, ports)).rejects.toThrow(
      'Artifact validation failed'
    );
  });

  it('should build projection with correct artifacts', async () => {
    await executeExperiment(testDefinition, ports);

    expect(mockProjectionBuilder.buildProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        artifacts: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        tables: {
          alerts: 'alerts',
          ohlcv: 'ohlcv',
        },
      })
    );
  });

  it('should update status to running before execution', async () => {
    await executeExperiment(testDefinition, ports);

    expect(mockExperimentTracker.updateStatus).toHaveBeenCalledWith('test-exp-123', 'running');
  });

  it('should update status to completed after execution', async () => {
    await executeExperiment(testDefinition, ports);

    expect(mockExperimentTracker.updateStatus).toHaveBeenCalledWith('test-exp-123', 'completed');
  });

  it('should update status to failed on error', async () => {
    mockProjectionBuilder.buildProjection = vi.fn().mockRejectedValue(new Error('Build failed'));

    await expect(executeExperiment(testDefinition, ports)).rejects.toThrow('Build failed');

    expect(mockExperimentTracker.updateStatus).toHaveBeenCalledWith('test-exp-123', 'failed');
  });

  it('should dispose projection after completion', async () => {
    await executeExperiment(testDefinition, ports);

    expect(mockProjectionBuilder.disposeProjection).toHaveBeenCalled();
  });

  it('should dispose projection even on error', async () => {
    // Mock simulation to fail for this test
    vi.mocked(executeSimulation).mockRejectedValueOnce(new Error('Simulation failed'));

    await expect(executeExperiment(testDefinition, ports)).rejects.toThrow('Simulation failed');

    expect(mockProjectionBuilder.disposeProjection).toHaveBeenCalled();
  });

  it('should return completed experiment', async () => {
    const result = await executeExperiment(testDefinition, ports);

    expect(result.status).toBe('completed');
    expect(result.outputs).toBeDefined();
    expect(result.outputs?.trades).toBe('trades-artifact-1');
    expect(result.outputs?.metrics).toBe('metrics-artifact-1');
  });
});
