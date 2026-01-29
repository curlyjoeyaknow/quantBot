/**
 * Create Experiment Handler Tests (Research Package)
 *
 * Tests for create-experiment handler following CLI handler pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResearchExperimentHandler } from '../../../../../src/handlers/research/experiments/create-experiment.js';
import type { ExperimentTrackerPort, Experiment, ExperimentDefinition } from '@quantbot/core';
import type { CommandContext } from '../../../../../src/core/command-context.js';

describe('createResearchExperimentHandler', () => {
  let mockExperimentTracker: ExperimentTrackerPort;
  let mockContext: CommandContext;

  beforeEach(() => {
    mockExperimentTracker = {
      createExperiment: vi.fn().mockImplementation(async (def: ExperimentDefinition) => {
        const experiment: Experiment = {
          ...def,
          status: 'pending',
        };
        return experiment;
      }),
      getExperiment: vi.fn(),
      listExperiments: vi.fn(),
      updateStatus: vi.fn(),
      storeResults: vi.fn(),
      findByInputArtifacts: vi.fn(),
    };

    mockContext = {
      services: {
        experimentTracker: () => mockExperimentTracker,
      },
    } as unknown as CommandContext;
  });

  it('should create experiment with all required fields', async () => {
    const result = await createResearchExperimentHandler(
      {
        name: 'momentum-v1',
        alerts: ['alert-1', 'alert-2'],
        ohlcv: ['ohlcv-1'],
        from: '2025-05-01',
        to: '2025-05-31',
      },
      mockContext
    );

    expect(result.experiment.name).toBe('momentum-v1');
    expect(result.experiment.status).toBe('pending');
    expect(result.experiment.inputs.alerts).toEqual(['alert-1', 'alert-2']);
    expect(result.experiment.inputs.ohlcv).toEqual(['ohlcv-1']);
    expect(result.experiment.config.dateRange).toEqual({
      from: '2025-05-01',
      to: '2025-05-31',
    });
    expect(result.message).toContain('created');

    // Verify experimentId format
    expect(result.experiment.experimentId).toMatch(/^exp-\d{8}T\d{6}-[a-z0-9]{6}$/);
  });

  it('should create experiment with optional fields', async () => {
    const result = await createResearchExperimentHandler(
      {
        name: 'momentum-v1',
        description: 'Test momentum strategy',
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
        strategies: ['strategy-1'],
        strategy: { name: 'momentum', threshold: 0.05 },
        from: '2025-05-01',
        to: '2025-05-31',
        params: { debug: true },
      },
      mockContext
    );

    expect(result.experiment.description).toBe('Test momentum strategy');
    expect(result.experiment.inputs.strategies).toEqual(['strategy-1']);
    expect(result.experiment.config.strategy).toEqual({ name: 'momentum', threshold: 0.05 });
    expect(result.experiment.config.params).toEqual({ debug: true });
  });

  it('should include provenance information', async () => {
    const result = await createResearchExperimentHandler(
      {
        name: 'momentum-v1',
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
        from: '2025-05-01',
        to: '2025-05-31',
      },
      mockContext
    );

    expect(result.experiment.provenance.gitCommit).toBeDefined();
    expect(result.experiment.provenance.gitDirty).toBeDefined();
    expect(result.experiment.provenance.engineVersion).toBe('1.0.0');
    expect(result.experiment.provenance.createdAt).toBeDefined();
  });

  it('should propagate errors from experiment tracker', async () => {
    const error = new Error('Database connection failed');
    vi.mocked(mockExperimentTracker.createExperiment).mockRejectedValue(error);

    await expect(
      createResearchExperimentHandler(
        {
          name: 'momentum-v1',
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
          from: '2025-05-01',
          to: '2025-05-31',
        },
        mockContext
      )
    ).rejects.toThrow('Database connection failed');
  });

  // Isolation test
  it('should be callable with plain objects', async () => {
    const plainContext = {
      services: {
        experimentTracker: () => ({
          createExperiment: async (def: ExperimentDefinition) => ({
            ...def,
            status: 'pending',
          }),
        }),
      },
    };

    const result = await createResearchExperimentHandler(
      {
        name: 'momentum-v1',
        alerts: ['alert-1'],
        ohlcv: ['ohlcv-1'],
        from: '2025-05-01',
        to: '2025-05-31',
      },
      plainContext as CommandContext
    );

    expect(result.experiment.name).toBe('momentum-v1');
  });
});
