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
import { PythonEngine } from '@quantbot/infra/utils';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('executeExperiment (integration)', () => {
  let tempDir: string;
  let manifestDb: string;
  let artifactsRoot: string;
  let experimentDb: string;
  let artifactStore: ArtifactStoreAdapter;
  let projectionBuilder: ProjectionBuilderAdapter;
  let experimentTracker: ExperimentTrackerAdapter;
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    // Create temp directory for test artifacts
    tempDir = mkdtempSync(join(tmpdir(), 'exp-integration-test-'));
    manifestDb = join(tempDir, 'manifest.sqlite');
    artifactsRoot = join(tempDir, 'artifacts');
    experimentDb = join(tempDir, 'experiments.duckdb');

    // Initialize Python engine
    pythonEngine = new PythonEngine();

    // Initialize adapters
    artifactStore = new ArtifactStoreAdapter(manifestDb, artifactsRoot, pythonEngine);
    projectionBuilder = new ProjectionBuilderAdapter(
      artifactStore,
      join(tempDir, 'projections'),
      undefined, // maxProjectionSizeBytes (use default)
      undefined, // metadataDbPath (use default)
      undefined, // batchSize (use default)
      artifactsRoot // artifactsRoot - must match artifact store
    );
    experimentTracker = new ExperimentTrackerAdapter(experimentDb, pythonEngine);
  });

  afterAll(() => {
    // Cleanup temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup temp directory:', error);
    }
  });

  it('should execute experiment with real artifacts', async () => {
    // This test creates test artifacts and executes a full experiment
    // NOTE: May fail if artifact_store spec has timestamp casting issues.
    // If this test fails, check packages/artifact_store/artifact_store/spec.py
    // for proper TIMESTAMP type handling in cast expressions.
  }, 30000); // 30 second timeout for integration test

    // 1. Create test artifacts with correct schemas
    const alertsPath = join(tempDir, 'alerts.csv');
    writeFileSync(
      alertsPath,
      'alert_ts_utc,chain,mint,alert_chat_id,alert_message_id,alert_id,caller_name_norm,caller_id,mint_source,bot_name,run_id\n' +
        '2024-01-01T00:00:00Z,solana,mint1111111111111111111111111111111111111111,123,456,123:456,test_caller,caller_1,alert_text,test_bot,run-1\n' +
        '2024-01-02T00:00:00Z,solana,mint2222222222222222222222222222222222222222,123,457,123:457,test_caller,caller_1,alert_text,test_bot,run-1\n'
    );

    const ohlcvPath = join(tempDir, 'ohlcv.csv');
    writeFileSync(
      ohlcvPath,
      'ts,open,high,low,close,volume\n' +
        '2024-01-01T00:00:00Z,1.0,1.5,0.9,1.4,1000\n' +
        '2024-01-01T00:01:00Z,1.4,1.6,1.3,1.5,1100\n' +
        '2024-01-01T00:02:00Z,1.5,1.7,1.4,1.6,1200\n'
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
      artifactType: 'ohlcv_slice',
      schemaVersion: 1,
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
