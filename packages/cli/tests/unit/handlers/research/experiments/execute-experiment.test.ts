/**
 * Execute Experiment Handler Tests (Research Package)
 *
 * Tests for execute-experiment handler following CLI handler pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeResearchExperimentHandler } from '../../../../../src/handlers/research/experiments/execute-experiment.js';
import type {
  ExperimentTrackerPort,
  ArtifactStorePort,
  ProjectionBuilderPort,
  Experiment,
} from '@quantbot/core';
import type { CommandContext } from '../../../../../src/core/command-context.js';

// Mock the executeExperiment workflow
vi.mock('@quantbot/workflows/experiments', () => ({
  executeExperiment: vi.fn(),
}));

import { executeExperiment } from '@quantbot/workflows/experiments';

describe('executeResearchExperimentHandler', () => {
  const mockExperiment: Experiment = {
    experimentId: 'exp-20260129120000-abc123',
    name: 'momentum-v1',
    inputs: {
      alerts: ['alert-1', 'alert-2'],
      ohlcv: ['ohlcv-1'],
    },
    config: {
      strategy: { name: 'momentum', threshold: 0.05 },
      dateRange: { from: '2025-05-01', to: '2025-05-31' },
      params: {},
    },
    provenance: {
      gitCommit: 'abc123',
      gitDirty: false,
      engineVersion: '1.0.0',
      createdAt: '2026-01-29T10:00:00Z',
    },
    status: 'pending',
  };

  const mockExecutionResult = {
    experimentId: 'exp-20260129120000-abc123',
    status: 'completed' as const,
    outputs: {
      trades: 'trades-artifact-id',
      metrics: 'metrics-artifact-id',
    },
  };

  let mockExperimentTracker: ExperimentTrackerPort;
  let mockArtifactStore: ArtifactStorePort;
  let mockProjectionBuilder: ProjectionBuilderPort;
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockExperimentTracker = {
      getExperiment: vi.fn().mockResolvedValue(mockExperiment),
      createExperiment: vi.fn(),
      listExperiments: vi.fn(),
      updateStatus: vi.fn(),
      storeResults: vi.fn(),
      findByInputArtifacts: vi.fn(),
    };

    mockArtifactStore = {
      getArtifact: vi.fn(),
      listArtifacts: vi.fn(),
      findByLogicalKey: vi.fn(),
      publishArtifact: vi.fn(),
      getLineage: vi.fn(),
      getDownstream: vi.fn(),
      supersede: vi.fn(),
    };

    mockProjectionBuilder = {
      buildProjection: vi.fn(),
      cleanCache: vi.fn(),
    };

    mockContext = {
      services: {
        experimentTracker: () => mockExperimentTracker,
        artifactStore: () => mockArtifactStore,
        projectionBuilder: () => mockProjectionBuilder,
      },
    } as unknown as CommandContext;

    // Mock executeExperiment to return success
    vi.mocked(executeExperiment).mockResolvedValue(mockExecutionResult);
  });

  it('should execute experiment successfully', async () => {
    const result = await executeResearchExperimentHandler(
      { experimentId: 'exp-20260129120000-abc123' },
      mockContext
    );

    expect(result.experimentId).toBe('exp-20260129120000-abc123');
    expect(result.status).toBe('completed');
    expect(result.outputs).toEqual({
      trades: 'trades-artifact-id',
      metrics: 'metrics-artifact-id',
    });
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('completed');

    // Verify services were called
    expect(mockExperimentTracker.getExperiment).toHaveBeenCalledWith('exp-20260129120000-abc123');
    expect(executeExperiment).toHaveBeenCalledWith(mockExperiment, {
      artifactStore: mockArtifactStore,
      projectionBuilder: mockProjectionBuilder,
      experimentTracker: mockExperimentTracker,
    });
  });

  it('should handle execution failure', async () => {
    const error = new Error('Simulation failed');
    vi.mocked(executeExperiment).mockRejectedValue(error);

    const result = await executeResearchExperimentHandler(
      { experimentId: 'exp-20260129120000-abc123' },
      mockContext
    );

    expect(result.experimentId).toBe('exp-20260129120000-abc123');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Simulation failed');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('failed');
  });

  it('should propagate errors from getExperiment', async () => {
    const error = new Error('Experiment not found');
    vi.mocked(mockExperimentTracker.getExperiment).mockRejectedValue(error);

    await expect(
      executeResearchExperimentHandler({ experimentId: 'nonexistent' }, mockContext)
    ).rejects.toThrow('Experiment not found');
  });

  // Isolation test
  it('should be callable with plain objects', async () => {
    const plainContext = {
      services: {
        experimentTracker: () => ({
          getExperiment: async () => mockExperiment,
        }),
        artifactStore: () => mockArtifactStore,
        projectionBuilder: () => mockProjectionBuilder,
      },
    };

    vi.mocked(executeExperiment).mockResolvedValue(mockExecutionResult);

    const result = await executeResearchExperimentHandler(
      { experimentId: 'exp-20260129120000-abc123' },
      plainContext as CommandContext
    );

    expect(result.status).toBe('completed');
  });
});
