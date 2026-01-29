/**
 * Execute Experiment Handler - Integration Tests
 *
 * Tests end-to-end experiment execution with real adapters.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executeExperiment } from '../../../src/experiments/index.js';
import type { ExperimentDefinition } from '@quantbot/core';
import {
  ArtifactStoreAdapter,
  ProjectionBuilderAdapter,
  ExperimentTrackerAdapter,
} from '@quantbot/storage';
import { PythonEngine } from '@quantbot/utils';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('executeExperiment (integration)', () => {
  let tempDir: string;
  let artifactStore: ArtifactStoreAdapter;
  let projectionBuilder: ProjectionBuilderAdapter;
  let experimentTracker: ExperimentTrackerAdapter;
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    // Create temp directory for test artifacts
    tempDir = mkdtempSync(join(tmpdir(), 'exp-integration-test-'));

    // Initialize Python engine
    pythonEngine = new PythonEngine();

    // Initialize adapters
    artifactStore = new ArtifactStoreAdapter(pythonEngine);
    projectionBuilder = new ProjectionBuilderAdapter(pythonEngine);
    experimentTracker = new ExperimentTrackerAdapter(pythonEngine);
  });

  afterAll(() => {
    // Cleanup temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup temp directory:', error);
    }
  });

  it.skip('should execute experiment with real artifacts', async () => {
    // This test requires real artifacts in the data lake
    // Skip for now - will be enabled when artifact store is fully integrated

    // 1. Create test artifacts
    const alertsPath = join(tempDir, 'alerts.csv');
    writeFileSync(
      alertsPath,
      'id,mint,timestamp,price\n' +
        'alert-1,mint-1,1704067200000,1.5\n' +
        'alert-2,mint-2,1704153600000,2.0\n'
    );

    const ohlcvPath = join(tempDir, 'ohlcv.csv');
    writeFileSync(
      ohlcvPath,
      'timestamp,open,high,low,close,volume\n' +
        '1704067200000,1.0,1.5,0.9,1.4,1000\n' +
        '1704067260000,1.4,1.6,1.3,1.5,1100\n' +
        '1704067320000,1.5,1.7,1.4,1.6,1200\n'
    );

    // 2. Publish artifacts
    const alertsArtifact = await artifactStore.publishArtifact({
      artifactType: 'alerts_v1',
      schemaVersion: 1,
      logicalKey: 'test-alerts-integration',
      dataPath: alertsPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit',
      gitDirty: false,
      params: {},
    });

    const ohlcvArtifact = await artifactStore.publishArtifact({
      artifactType: 'ohlcv_slice_v2',
      schemaVersion: 2,
      logicalKey: 'test-ohlcv-integration',
      dataPath: ohlcvPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit',
      gitDirty: false,
      params: {},
    });

    expect(alertsArtifact.success).toBe(true);
    expect(ohlcvArtifact.success).toBe(true);

    // 3. Create experiment definition
    const definition: ExperimentDefinition = {
      experimentId: `exp-integration-${Date.now()}`,
      name: 'Integration Test Experiment',
      description: 'Test experiment for integration testing',
      inputs: {
        alerts: [alertsArtifact.artifactId!],
        ohlcv: [ohlcvArtifact.artifactId!],
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
        dateRange: { from: '2024-01-01', to: '2024-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'test-commit',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    // 4. Execute experiment
    const result = await executeExperiment(definition, {
      artifactStore,
      projectionBuilder,
      experimentTracker,
    });

    // 5. Verify results
    expect(result.status).toBe('completed');
    expect(result.outputs).toBeDefined();
    expect(result.outputs?.trades).toBeDefined();
    expect(result.outputs?.metrics).toBeDefined();
    expect(result.outputs?.curves).toBeDefined();

    // 6. Verify lineage
    if (result.outputs?.trades) {
      const lineage = await artifactStore.getLineage(result.outputs.trades);
      expect(lineage.inputs).toHaveLength(2);
      expect(lineage.inputs.map((a) => a.artifactId)).toContain(alertsArtifact.artifactId);
      expect(lineage.inputs.map((a) => a.artifactId)).toContain(ohlcvArtifact.artifactId);
    }
  });

  it('should handle experiment with no candles gracefully', async () => {
    // Test with empty date range (no candles)
    const definition: ExperimentDefinition = {
      experimentId: `exp-empty-${Date.now()}`,
      name: 'Empty Experiment',
      inputs: {
        alerts: [],
        ohlcv: [],
      },
      config: {
        strategy: {
          name: 'momentum',
          exit: {
            targets: [{ target: 2, percent: 1.0 }],
          },
        },
        dateRange: { from: '2024-01-01', to: '2024-01-02' },
        params: {},
      },
      provenance: {
        gitCommit: 'test-commit',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    };

    // Should fail validation (no artifacts)
    await expect(
      executeExperiment(definition, {
        artifactStore,
        projectionBuilder,
        experimentTracker,
      })
    ).rejects.toThrow();
  });
});
