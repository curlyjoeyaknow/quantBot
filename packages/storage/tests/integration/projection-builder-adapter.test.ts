/**
 * Integration tests for ProjectionBuilderAdapter
 *
 * Tests the adapter with real artifact store and DuckDB.
 * These tests require:
 * - Real artifact store with manifest database
 * - Real Parquet files
 * - DuckDB Python bindings
 *
 * Skip if environment is not configured.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { ProjectionBuilderAdapter } from '../../src/adapters/projection-builder-adapter.js';
import { ArtifactStoreAdapter } from '../../src/adapters/artifact-store-adapter.js';
import { PythonEngine } from '@quantbot/infra/utils';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Skip integration tests if environment is not configured
const SKIP_INTEGRATION =
  !process.env.ARTIFACT_MANIFEST_DB || !existsSync(process.env.ARTIFACT_MANIFEST_DB);

describe.skipIf(SKIP_INTEGRATION)('ProjectionBuilderAdapter (integration)', () => {
  let artifactStore: ArtifactStoreAdapter;
  let projectionBuilder: ProjectionBuilderAdapter;
  let tempCacheDir: string;

  beforeAll(() => {
    const manifestDb =
      process.env.ARTIFACT_MANIFEST_DB || '/home/memez/opn/manifest/manifest.sqlite';
    const artifactsRoot = process.env.ARTIFACTS_ROOT || '/home/memez/opn/artifacts';
    const pythonEngine = new PythonEngine();

    artifactStore = new ArtifactStoreAdapter(manifestDb, artifactsRoot, pythonEngine);

    tempCacheDir = join(tmpdir(), `projection-integration-test-${Date.now()}`);
    projectionBuilder = new ProjectionBuilderAdapter(artifactStore, tempCacheDir);
  });

  afterEach(() => {
    // Clean up temporary cache directory
    if (existsSync(tempCacheDir)) {
      rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  it('should build projection from real alert artifacts', async () => {
    // Find some alert artifacts
    const artifacts = await artifactStore.listArtifacts({
      artifactType: 'alerts',
      limit: 2,
    });

    if (artifacts.length === 0) {
      console.warn('No alert artifacts found, skipping test');
      return;
    }

    const artifactIds = artifacts.map((a) => a.artifactId);

    const result = await projectionBuilder.buildProjection({
      projectionId: 'integration-test-alerts',
      artifacts: { alerts: artifactIds },
      tables: { alerts: 'alerts' },
      indexes: [{ table: 'alerts', columns: ['alert_ts_utc'] }],
    });

    expect(result.projectionId).toBe('integration-test-alerts');
    expect(result.artifactCount).toBe(artifactIds.length);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe('alerts');
    expect(result.tables[0].rowCount).toBeGreaterThan(0);
    expect(result.tables[0].columns.length).toBeGreaterThan(0);
    expect(result.tables[0].indexes).toContain('idx_alerts_alert_ts_utc');
    expect(existsSync(result.duckdbPath)).toBe(true);
  });

  it('should build projection from real OHLCV artifacts', async () => {
    // Find some OHLCV artifacts
    const artifacts = await artifactStore.listArtifacts({
      artifactType: 'ohlcv_slice',
      limit: 2,
    });

    if (artifacts.length === 0) {
      console.warn('No OHLCV artifacts found, skipping test');
      return;
    }

    const artifactIds = artifacts.map((a) => a.artifactId);

    const result = await projectionBuilder.buildProjection({
      projectionId: 'integration-test-ohlcv',
      artifacts: { ohlcv: artifactIds },
      tables: { ohlcv: 'ohlcv' },
      indexes: [{ table: 'ohlcv', columns: ['timestamp', 'token_address'] }],
    });

    expect(result.projectionId).toBe('integration-test-ohlcv');
    expect(result.artifactCount).toBe(artifactIds.length);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe('ohlcv');
    expect(result.tables[0].rowCount).toBeGreaterThan(0);
    expect(result.tables[0].columns.length).toBeGreaterThan(0);
    expect(result.tables[0].indexes).toContain('idx_ohlcv_timestamp_token_address');
    expect(existsSync(result.duckdbPath)).toBe(true);
  });

  it('should build multi-table projection', async () => {
    // Find artifacts of both types
    const alertArtifacts = await artifactStore.listArtifacts({
      artifactType: 'alerts',
      limit: 1,
    });

    const ohlcvArtifacts = await artifactStore.listArtifacts({
      artifactType: 'ohlcv_slice',
      limit: 1,
    });

    if (alertArtifacts.length === 0 || ohlcvArtifacts.length === 0) {
      console.warn('Missing artifacts for multi-table test, skipping');
      return;
    }

    const result = await projectionBuilder.buildProjection({
      projectionId: 'integration-test-multi',
      artifacts: {
        alerts: [alertArtifacts[0].artifactId],
        ohlcv: [ohlcvArtifacts[0].artifactId],
      },
      tables: {
        alerts: 'alerts',
        ohlcv: 'ohlcv',
      },
    });

    expect(result.projectionId).toBe('integration-test-multi');
    expect(result.artifactCount).toBe(2);
    expect(result.tables).toHaveLength(2);
    expect(result.tables.map((t) => t.name).sort()).toEqual(['alerts', 'ohlcv']);
    expect(existsSync(result.duckdbPath)).toBe(true);
  });

  it('should dispose projection', async () => {
    // Build a projection
    const artifacts = await artifactStore.listArtifacts({
      artifactType: 'alerts',
      limit: 1,
    });

    if (artifacts.length === 0) {
      console.warn('No artifacts found, skipping test');
      return;
    }

    const result = await projectionBuilder.buildProjection({
      projectionId: 'integration-test-dispose',
      artifacts: { alerts: [artifacts[0].artifactId] },
      tables: { alerts: 'alerts' },
    });

    expect(existsSync(result.duckdbPath)).toBe(true);

    // Dispose it
    await projectionBuilder.disposeProjection('integration-test-dispose');

    expect(existsSync(result.duckdbPath)).toBe(false);
  });

  it('should check projection existence', async () => {
    // Build a projection
    const artifacts = await artifactStore.listArtifacts({
      artifactType: 'alerts',
      limit: 1,
    });

    if (artifacts.length === 0) {
      console.warn('No artifacts found, skipping test');
      return;
    }

    await projectionBuilder.buildProjection({
      projectionId: 'integration-test-exists',
      artifacts: { alerts: [artifacts[0].artifactId] },
      tables: { alerts: 'alerts' },
    });

    const exists = await projectionBuilder.projectionExists('integration-test-exists');
    expect(exists).toBe(true);

    const notExists = await projectionBuilder.projectionExists('nonexistent');
    expect(notExists).toBe(false);
  });
});
