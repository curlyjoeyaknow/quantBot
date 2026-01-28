import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExperimentTrackerAdapter } from '../../../src/adapters/experiment-tracker-adapter.js';
import type { PythonEngine } from '@quantbot/utils';
import type { ExperimentDefinition, ExperimentResults } from '@quantbot/core';
import { NotFoundError } from '@quantbot/infra/utils';

describe('ExperimentTrackerAdapter', () => {
  let mockPythonEngine: PythonEngine;
  let adapter: ExperimentTrackerAdapter;

  const dbPath = '/tmp/test-experiments.duckdb';

  beforeEach(() => {
    mockPythonEngine = {
      runScriptWithStdin: vi.fn(),
    } as unknown as PythonEngine;

    adapter = new ExperimentTrackerAdapter(dbPath, mockPythonEngine);
  });

  describe('createExperiment', () => {
    it('should create experiment with all fields', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-123',
        name: 'Test Experiment',
        description: 'Test description',
        inputs: {
          alerts: ['alert-1', 'alert-2'],
          ohlcv: ['ohlcv-1'],
          strategies: ['strategy-1'],
        },
        config: {
          strategy: { name: 'momentum', threshold: 0.05 },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: { param1: 'value1' },
        },
        provenance: {
          gitCommit: 'abc123',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      const mockExperiment = {
        ...definition,
        status: 'pending' as const,
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockExperiment);

      const result = await adapter.createExperiment(definition);

      expect(result).toEqual(mockExperiment);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'create_experiment',
          dbPath,
          definition: expect.objectContaining({
            experimentId: 'exp-123',
            name: 'Test Experiment',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should create experiment without optional fields', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-456',
        name: 'Minimal Experiment',
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: { name: 'simple' },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'def456',
          gitDirty: true,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
      };

      const mockExperiment = {
        ...definition,
        status: 'pending' as const,
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockExperiment);

      const result = await adapter.createExperiment(definition);

      expect(result.experimentId).toBe('exp-456');
      expect(result.status).toBe('pending');
    });
  });

  describe('getExperiment', () => {
    it('should get experiment by ID', async () => {
      const mockExperiment = {
        experimentId: 'exp-789',
        name: 'Retrieved Experiment',
        status: 'completed' as const,
        inputs: {
          alerts: ['alert-1'],
          ohlcv: ['ohlcv-1'],
        },
        config: {
          strategy: { name: 'test' },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'ghi789',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: '2026-01-28T00:00:00Z',
        },
        outputs: {
          trades: 'trades-123',
          metrics: 'metrics-456',
        },
        execution: {
          startedAt: '2026-01-28T00:00:00Z',
          completedAt: '2026-01-28T01:00:00Z',
          duration: 3600000,
        },
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockExperiment);

      const result = await adapter.getExperiment('exp-789');

      expect(result).toEqual(mockExperiment);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'get_experiment',
          dbPath,
          experimentId: 'exp-789',
        }),
        expect.any(Object)
      );
    });

    it('should throw NotFoundError when experiment not found', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValue(
        new Error('Experiment not found: invalid-id')
      );

      await expect(adapter.getExperiment('invalid-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listExperiments', () => {
    it('should list experiments with filters', async () => {
      const mockExperiments = [
        {
          experimentId: 'exp-1',
          name: 'Experiment 1',
          status: 'completed' as const,
          inputs: {
            alerts: ['alert-1'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: { name: 'test' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        },
        {
          experimentId: 'exp-2',
          name: 'Experiment 2',
          status: 'running' as const,
          inputs: {
            alerts: ['alert-2'],
            ohlcv: ['ohlcv-2'],
          },
          config: {
            strategy: { name: 'test2' },
            dateRange: { from: '2025-02-01', to: '2025-02-28' },
            params: {},
          },
          provenance: {
            gitCommit: 'def456',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T01:00:00Z',
          },
          execution: {
            startedAt: '2026-01-28T01:00:00Z',
          },
        },
      ];

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockExperiments);

      const result = await adapter.listExperiments({ status: 'completed', limit: 10 });

      expect(result).toEqual(mockExperiments);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'list_experiments',
          dbPath,
          filter: expect.objectContaining({
            status: 'completed',
            limit: 10,
          }),
        }),
        expect.any(Object)
      );
    });

    it('should list experiments with empty filter', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue([]);

      const result = await adapter.listExperiments({});

      expect(result).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update experiment status to running', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      await adapter.updateStatus('exp-123', 'running');

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'update_status',
          dbPath,
          experimentId: 'exp-123',
          status: 'running',
        }),
        expect.any(Object)
      );
    });

    it('should update experiment status to completed', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      await adapter.updateStatus('exp-456', 'completed');

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'update_status',
          status: 'completed',
        }),
        expect.any(Object)
      );
    });

    it('should update experiment status to failed', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      await adapter.updateStatus('exp-789', 'failed');

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          status: 'failed',
        }),
        expect.any(Object)
      );
    });
  });

  describe('storeResults', () => {
    it('should store all result artifact IDs', async () => {
      const results: ExperimentResults = {
        tradesArtifactId: 'trades-123',
        metricsArtifactId: 'metrics-456',
        curvesArtifactId: 'curves-789',
        diagnosticsArtifactId: 'diagnostics-012',
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      await adapter.storeResults('exp-123', results);

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'store_results',
          dbPath,
          experimentId: 'exp-123',
          results: expect.objectContaining({
            tradesArtifactId: 'trades-123',
            metricsArtifactId: 'metrics-456',
            curvesArtifactId: 'curves-789',
            diagnosticsArtifactId: 'diagnostics-012',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should store partial results', async () => {
      const results: ExperimentResults = {
        tradesArtifactId: 'trades-123',
        metricsArtifactId: 'metrics-456',
      };

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue({ success: true });

      await adapter.storeResults('exp-456', results);

      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          results: expect.objectContaining({
            tradesArtifactId: 'trades-123',
            metricsArtifactId: 'metrics-456',
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe('findByInputArtifacts', () => {
    it('should find experiments by single artifact ID', async () => {
      const mockExperiments = [
        {
          experimentId: 'exp-1',
          name: 'Experiment 1',
          status: 'completed' as const,
          inputs: {
            alerts: ['alert-X'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: { name: 'test' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        },
      ];

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockExperiments);

      const result = await adapter.findByInputArtifacts(['alert-X']);

      expect(result).toEqual(mockExperiments);
      expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledWith(
        expect.stringContaining('experiment_tracker_ops.py'),
        expect.objectContaining({
          operation: 'find_by_input_artifacts',
          dbPath,
          artifactIds: ['alert-X'],
        }),
        expect.any(Object)
      );
    });

    it('should find experiments by multiple artifact IDs', async () => {
      const mockExperiments = [
        {
          experimentId: 'exp-1',
          name: 'Experiment 1',
          status: 'completed' as const,
          inputs: {
            alerts: ['alert-1', 'alert-2'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: { name: 'test' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T00:00:00Z',
          },
        },
        {
          experimentId: 'exp-2',
          name: 'Experiment 2',
          status: 'running' as const,
          inputs: {
            alerts: ['alert-3'],
            ohlcv: ['ohlcv-1'],
          },
          config: {
            strategy: { name: 'test2' },
            dateRange: { from: '2025-02-01', to: '2025-02-28' },
            params: {},
          },
          provenance: {
            gitCommit: 'def456',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: '2026-01-28T01:00:00Z',
          },
          execution: {
            startedAt: '2026-01-28T01:00:00Z',
          },
        },
      ];

      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockExperiments);

      const result = await adapter.findByInputArtifacts(['alert-1', 'ohlcv-1']);

      expect(result).toHaveLength(2);
      expect(result[0].experimentId).toBe('exp-1');
      expect(result[1].experimentId).toBe('exp-2');
    });

    it('should return empty array when no experiments found', async () => {
      vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue([]);

      const result = await adapter.findByInputArtifacts(['nonexistent-artifact']);

      expect(result).toEqual([]);
    });
  });
});
