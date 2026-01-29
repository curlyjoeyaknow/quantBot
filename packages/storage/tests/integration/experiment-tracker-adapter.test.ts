import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExperimentTrackerAdapter } from '../../src/adapters/experiment-tracker-adapter.js';
import type { ExperimentDefinition } from '@quantbot/core';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { NotFoundError } from '@quantbot/infra/utils';

describe('ExperimentTrackerAdapter (integration)', () => {
  const testDbPath = `/tmp/test-experiments-${Date.now()}.duckdb`;
  let adapter: ExperimentTrackerAdapter;

  // Increase timeout for DuckDB operations
  vi.setConfig({ testTimeout: 15000 });

  beforeAll(() => {
    adapter = new ExperimentTrackerAdapter(testDbPath);
  });

  afterAll(async () => {
    // Clean up test database
    if (existsSync(testDbPath)) {
      await unlink(testDbPath);
    }
  });

  describe('full experiment lifecycle', () => {
    it('should track experiment from creation to completion', async () => {
      // Create experiment
      const definition: ExperimentDefinition = {
        experimentId: 'exp-lifecycle-test',
        name: 'Lifecycle Test Experiment',
        description: 'Testing full experiment lifecycle',
        inputs: {
          alerts: ['alert-1', 'alert-2'],
          ohlcv: ['ohlcv-1'],
          strategies: ['strategy-1'],
        },
        config: {
          strategy: { name: 'momentum', threshold: 0.05 },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: { testParam: 'testValue' },
        },
        provenance: {
          gitCommit: 'abc123def456',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: new Date().toISOString(),
        },
      };

      const created = await adapter.createExperiment(definition);

      // Verify initial state
      expect(created.experimentId).toBe('exp-lifecycle-test');
      expect(created.name).toBe('Lifecycle Test Experiment');
      expect(created.status).toBe('pending');
      expect(created.inputs.alerts).toEqual(['alert-1', 'alert-2']);
      expect(created.inputs.ohlcv).toEqual(['ohlcv-1']);
      expect(created.inputs.strategies).toEqual(['strategy-1']);
      expect(created.outputs).toBeUndefined();
      expect(created.execution).toBeUndefined();

      // Update status to running
      await adapter.updateStatus('exp-lifecycle-test', 'running');

      let experiment = await adapter.getExperiment('exp-lifecycle-test');
      expect(experiment.status).toBe('running');
      expect(experiment.execution).toBeDefined();
      expect(experiment.execution?.startedAt).toBeDefined();

      // Store results
      await adapter.storeResults('exp-lifecycle-test', {
        tradesArtifactId: 'trades-123',
        metricsArtifactId: 'metrics-456',
        curvesArtifactId: 'curves-789',
        diagnosticsArtifactId: 'diagnostics-012',
      });

      experiment = await adapter.getExperiment('exp-lifecycle-test');
      expect(experiment.outputs).toBeDefined();
      expect(experiment.outputs?.trades).toBe('trades-123');
      expect(experiment.outputs?.metrics).toBe('metrics-456');
      expect(experiment.outputs?.curves).toBe('curves-789');
      expect(experiment.outputs?.diagnostics).toBe('diagnostics-012');

      // Complete experiment
      await adapter.updateStatus('exp-lifecycle-test', 'completed');

      experiment = await adapter.getExperiment('exp-lifecycle-test');
      expect(experiment.status).toBe('completed');
      expect(experiment.execution?.completedAt).toBeDefined();
      expect(experiment.execution?.duration).toBeGreaterThan(0);
    });

    it('should track failed experiment', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-failed-test',
        name: 'Failed Experiment',
        inputs: {
          alerts: ['alert-3'],
          ohlcv: ['ohlcv-2'],
        },
        config: {
          strategy: { name: 'test' },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'def456',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: new Date().toISOString(),
        },
      };

      await adapter.createExperiment(definition);
      await adapter.updateStatus('exp-failed-test', 'running');
      await adapter.updateStatus('exp-failed-test', 'failed');

      const experiment = await adapter.getExperiment('exp-failed-test');
      expect(experiment.status).toBe('failed');
      expect(experiment.execution?.completedAt).toBeDefined();
    });
  });

  describe('listExperiments', () => {
    beforeAll(async () => {
      // Create multiple experiments for testing
      const experiments: ExperimentDefinition[] = [
        {
          experimentId: 'exp-list-1',
          name: 'List Test 1',
          inputs: { alerts: ['alert-A'], ohlcv: ['ohlcv-A'] },
          config: {
            strategy: { name: 'test1' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'commit1abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        },
        {
          experimentId: 'exp-list-2',
          name: 'List Test 2',
          inputs: { alerts: ['alert-B'], ohlcv: ['ohlcv-B'] },
          config: {
            strategy: { name: 'test2' },
            dateRange: { from: '2025-02-01', to: '2025-02-28' },
            params: {},
          },
          provenance: {
            gitCommit: 'commit2abc456',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        },
        {
          experimentId: 'exp-list-3',
          name: 'List Test 3',
          inputs: { alerts: ['alert-C'], ohlcv: ['ohlcv-C'] },
          config: {
            strategy: { name: 'test3' },
            dateRange: { from: '2025-03-01', to: '2025-03-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'commit1abc123',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        },
      ];

      for (const exp of experiments) {
        await adapter.createExperiment(exp);
      }

      // Set different statuses
      await adapter.updateStatus('exp-list-1', 'running');
      await adapter.updateStatus('exp-list-2', 'completed');
    }, 30000); // 30 second timeout for beforeAll hook

    it('should list all experiments', async () => {
      const experiments = await adapter.listExperiments({});

      expect(experiments.length).toBeGreaterThanOrEqual(3);
      const listExperiments = experiments.filter((e) => e.experimentId.startsWith('exp-list-'));
      expect(listExperiments.length).toBe(3);
    });

    it('should filter by status', async () => {
      const pendingExperiments = await adapter.listExperiments({ status: 'pending' });

      expect(pendingExperiments.some((e) => e.experimentId === 'exp-list-3')).toBe(true);
      expect(pendingExperiments.every((e) => e.status === 'pending')).toBe(true);
    });

    it('should filter by git commit', async () => {
      const experiments = await adapter.listExperiments({ gitCommit: 'commit1abc123' });

      const commit1Experiments = experiments.filter((e) => e.experimentId.startsWith('exp-list-'));
      expect(commit1Experiments.length).toBe(2);
      expect(commit1Experiments.some((e) => e.experimentId === 'exp-list-1')).toBe(true);
      expect(commit1Experiments.some((e) => e.experimentId === 'exp-list-3')).toBe(true);
    });

    it('should respect limit', async () => {
      const experiments = await adapter.listExperiments({ limit: 2 });

      expect(experiments.length).toBeLessThanOrEqual(2);
    });
  });

  describe('findByInputArtifacts', () => {
    beforeAll(async () => {
      // Create experiments with specific artifacts
      const experiments: ExperimentDefinition[] = [
        {
          experimentId: 'exp-artifact-1',
          name: 'Artifact Test 1',
          inputs: {
            alerts: ['shared-alert-X'],
            ohlcv: ['ohlcv-unique-1'],
          },
          config: {
            strategy: { name: 'test' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'abc',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        },
        {
          experimentId: 'exp-artifact-2',
          name: 'Artifact Test 2',
          inputs: {
            alerts: ['shared-alert-X', 'alert-unique-2'],
            ohlcv: ['ohlcv-unique-2'],
          },
          config: {
            strategy: { name: 'test' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'def',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        },
        {
          experimentId: 'exp-artifact-3',
          name: 'Artifact Test 3',
          inputs: {
            alerts: ['alert-unique-3'],
            ohlcv: ['shared-ohlcv-Y'],
            strategies: ['strategy-Z'],
          },
          config: {
            strategy: { name: 'test' },
            dateRange: { from: '2025-01-01', to: '2025-01-31' },
            params: {},
          },
          provenance: {
            gitCommit: 'ghi',
            gitDirty: false,
            engineVersion: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        },
      ];

      for (const exp of experiments) {
        await adapter.createExperiment(exp);
      }
    }, 30000); // 30 second timeout for beforeAll hook

    it('should find experiments by shared alert artifact', async () => {
      const experiments = await adapter.findByInputArtifacts(['shared-alert-X']);

      const artifactExperiments = experiments.filter((e) =>
        e.experimentId.startsWith('exp-artifact-')
      );
      expect(artifactExperiments.length).toBe(2);
      expect(artifactExperiments.some((e) => e.experimentId === 'exp-artifact-1')).toBe(true);
      expect(artifactExperiments.some((e) => e.experimentId === 'exp-artifact-2')).toBe(true);
    });

    it('should find experiments by unique artifact', async () => {
      const experiments = await adapter.findByInputArtifacts(['ohlcv-unique-1']);

      const artifactExperiments = experiments.filter((e) =>
        e.experimentId.startsWith('exp-artifact-')
      );
      expect(artifactExperiments.length).toBe(1);
      expect(artifactExperiments[0].experimentId).toBe('exp-artifact-1');
    });

    it('should find experiments by strategy artifact', async () => {
      const experiments = await adapter.findByInputArtifacts(['strategy-Z']);

      const artifactExperiments = experiments.filter((e) =>
        e.experimentId.startsWith('exp-artifact-')
      );
      expect(artifactExperiments.length).toBe(1);
      expect(artifactExperiments[0].experimentId).toBe('exp-artifact-3');
    });

    it('should find experiments by multiple artifacts', async () => {
      const experiments = await adapter.findByInputArtifacts(['shared-alert-X', 'shared-ohlcv-Y']);

      const artifactExperiments = experiments.filter((e) =>
        e.experimentId.startsWith('exp-artifact-')
      );
      expect(artifactExperiments.length).toBe(3);
    });

    it('should return empty array for nonexistent artifact', async () => {
      const experiments = await adapter.findByInputArtifacts(['nonexistent-artifact-XYZ']);

      const artifactExperiments = experiments.filter((e) =>
        e.experimentId.startsWith('exp-artifact-')
      );
      expect(artifactExperiments.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw NotFoundError for nonexistent experiment', async () => {
      await expect(adapter.getExperiment('nonexistent-exp-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('partial results storage', () => {
    it('should store partial results', async () => {
      const definition: ExperimentDefinition = {
        experimentId: 'exp-partial-results',
        name: 'Partial Results Test',
        inputs: {
          alerts: ['alert-partial'],
          ohlcv: ['ohlcv-partial'],
        },
        config: {
          strategy: { name: 'test' },
          dateRange: { from: '2025-01-01', to: '2025-01-31' },
          params: {},
        },
        provenance: {
          gitCommit: 'partial',
          gitDirty: false,
          engineVersion: '1.0.0',
          createdAt: new Date().toISOString(),
        },
      };

      await adapter.createExperiment(definition);

      // Store only trades and metrics
      await adapter.storeResults('exp-partial-results', {
        tradesArtifactId: 'trades-partial',
        metricsArtifactId: 'metrics-partial',
      });

      const experiment = await adapter.getExperiment('exp-partial-results');
      expect(experiment.outputs?.trades).toBe('trades-partial');
      expect(experiment.outputs?.metrics).toBe('metrics-partial');
      expect(experiment.outputs?.curves).toBeUndefined();
      expect(experiment.outputs?.diagnostics).toBeUndefined();
    });
  });
});
