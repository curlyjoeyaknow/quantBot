/**
 * Catalog Functions Unit Tests
 * 
 * NOTE: These tests are currently skipped because the catalog implementation
 * is stubbed out pending native duckdb-node integration.
 * 
 * TODO: Re-enable these tests once catalog is reimplemented with native duckdb-node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBClient } from '@quantbot/storage';
import {
  initializeCatalog,
  registerRun,
  catalogAllRuns,
  queryRuns,
  getArtifactPath,
  getCatalogStats,
} from './catalog.js';
import { createRunDirectory } from './writer.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const TEST_BASE_DIR = 'test-runs-catalog';
const TEST_DB_DIR = 'test-db-catalog';

describe('Catalog Functions', () => {
  let db: DuckDBClient;
  let testDbPath: string;

  beforeEach(async () => {
    // Use a temporary file database instead of :memory: for persistence
    testDbPath = join(TEST_DB_DIR, `test-${randomUUID()}.duckdb`);
    await fs.mkdir(TEST_DB_DIR, { recursive: true });
    db = new DuckDBClient(testDbPath);
    await initializeCatalog(db);
  });

  afterEach(async () => {
    await db.close();
    try {
      await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
      await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('initializeCatalog', () => {
    it('should create catalog tables', async () => {
      // Check runs catalog table exists
      const runsTable = await db.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_name = 'backtest_runs_catalog'
      `);
      expect(runsTable.rows[0][0]).toBe(1);

      // Check artifacts catalog table exists
      const artifactsTable = await db.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_name = 'backtest_artifacts_catalog'
      `);
      expect(artifactsTable.rows[0][0]).toBe(1);
    });
  });

  describe('registerRun', () => {
    it('should register a completed run', async () => {
      // Create a complete run
      const runId = `test-${randomUUID()}`;
      const runDir = await createRunDirectory(runId, 'path-only', {
        baseDir: TEST_BASE_DIR,
      });

      runDir.updateManifest({
        git_commit: 'abc123',
        git_branch: 'main',
        git_dirty: false,
        dataset: {
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-31T23:59:59Z',
          interval: '5m',
          calls_count: 100,
        },
      });

      await runDir.writeArtifact('alerts', [{ call_id: 'call-1', value: 1 }]);
      await runDir.writeArtifact('paths', [{ run_id: runId, call_id: 'call-1', value: 2 }]);
      await runDir.markSuccess();

      // Register run
      await registerRun(db, runDir.getRunDir());

      // Verify run was registered
      const runsResult = await db.query(`
        SELECT run_id, run_type, status, git_commit
        FROM backtest_runs_catalog
        WHERE run_id = '${runId}'
      `);

      expect(runsResult.rows.length).toBe(1);
      const runIdx = runsResult.columns.findIndex((c) => c.name === 'run_id');
      const typeIdx = runsResult.columns.findIndex((c) => c.name === 'run_type');
      const statusIdx = runsResult.columns.findIndex((c) => c.name === 'status');
      const commitIdx = runsResult.columns.findIndex((c) => c.name === 'git_commit');
      
      expect(runsResult.rows[0][runIdx]).toBe(runId);
      expect(runsResult.rows[0][typeIdx]).toBe('path-only');
      expect(runsResult.rows[0][statusIdx]).toBe('completed');
      expect(runsResult.rows[0][commitIdx]).toBe('abc123');

      // Verify artifacts were registered
      const artifactsResult = await db.query(`
        SELECT artifact_type, rows
        FROM backtest_artifacts_catalog
        WHERE run_id = '${runId}'
        ORDER BY artifact_type
      `);

      expect(artifactsResult.rows.length).toBe(2);
      const typeColIdx = artifactsResult.columns.findIndex((c) => c.name === 'artifact_type');
      const rowsColIdx = artifactsResult.columns.findIndex((c) => c.name === 'rows');
      
      expect(artifactsResult.rows[0][typeColIdx]).toBe('alerts');
      expect(artifactsResult.rows[0][rowsColIdx]).toBe(1);
      expect(artifactsResult.rows[1][typeColIdx]).toBe('paths');
      expect(artifactsResult.rows[1][rowsColIdx]).toBe(1);
    });

    it('should skip incomplete runs', async () => {
      const runId = `test-${randomUUID()}`;
      const runDir = await createRunDirectory(runId, 'path-only', {
        baseDir: TEST_BASE_DIR,
      });

      // Don't mark as success
      await registerRun(db, runDir.getRunDir());

      // Verify run was NOT registered
      const runsResult = await db.query(`
        SELECT COUNT(*) as count
        FROM backtest_runs_catalog
        WHERE run_id = '${runId}'
      `);

      expect(runsResult.rows[0][0]).toBe(0);
    });

    it('should skip already registered runs', async () => {
      const runId = `test-${randomUUID()}`;
      const runDir = await createRunDirectory(runId, 'path-only', {
        baseDir: TEST_BASE_DIR,
      });

      await runDir.markSuccess();

      // Register twice
      await registerRun(db, runDir.getRunDir());
      await registerRun(db, runDir.getRunDir());

      // Verify only one entry
      const runsResult = await db.query(`
        SELECT COUNT(*) as count
        FROM backtest_runs_catalog
        WHERE run_id = '${runId}'
      `);

      expect(runsResult.rows[0][0]).toBe(1);
    });
  });

  describe('catalogAllRuns', () => {
    beforeEach(async () => {
      // Clean up any existing runs in TEST_BASE_DIR before each test
      try {
        await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }
    });

    it('should catalog multiple runs', async () => {
      // Create 3 runs
      const runIds = [];
      for (let i = 0; i < 3; i++) {
        const runId = `test-${randomUUID()}`;
        runIds.push(runId);

        const runDir = await createRunDirectory(runId, 'path-only', {
          baseDir: TEST_BASE_DIR,
        });

        await runDir.markSuccess();
      }

      // Catalog all runs
      const result = await catalogAllRuns(db, TEST_BASE_DIR);

      expect(result.registered).toBe(3);
      expect(result.skipped).toBe(0);

      // Verify all runs were registered
      const runsResult = await db.query('SELECT COUNT(*) as count FROM backtest_runs_catalog');
      expect(runsResult.rows[0][0]).toBe(3);
    });

    it('should skip incomplete runs', async () => {
      // Create 2 complete runs and 1 incomplete
      for (let i = 0; i < 2; i++) {
        const runDir = await createRunDirectory(`test-${randomUUID()}`, 'path-only', {
          baseDir: TEST_BASE_DIR,
        });
        await runDir.markSuccess();
      }

      // Create incomplete run (status will be 'running')
      await createRunDirectory(`test-${randomUUID()}`, 'path-only', {
        baseDir: TEST_BASE_DIR,
      });

      // Catalog all runs
      const result = await catalogAllRuns(db, TEST_BASE_DIR);

      expect(result.registered).toBe(2);
      expect(result.skipped).toBe(1); // The incomplete run should be skipped

      // Verify only complete runs were registered
      const runsResult = await db.query('SELECT COUNT(*) as count FROM backtest_runs_catalog');
      expect(runsResult.rows[0][0]).toBe(2);
    });
  });

  describe('queryRuns', () => {
    beforeEach(async () => {
      // Create test runs
      const runTypes = ['path-only', 'policy', 'optimization'];
      const statuses = ['completed', 'completed', 'failed'];
      const branches = ['main', 'feature', 'main'];

      for (let i = 0; i < 3; i++) {
        const runDir = await createRunDirectory(`test-${randomUUID()}`, runTypes[i] as any, {
          baseDir: TEST_BASE_DIR,
        });

        runDir.updateManifest({
          git_branch: branches[i],
          status: statuses[i] as any,
        });

        if (statuses[i] === 'completed') {
          await runDir.markSuccess();
        } else {
          await runDir.markFailure(new Error('Test error'));
        }

        await registerRun(db, runDir.getRunDir());
      }
    });

    it('should query all runs', async () => {
      const runs = await queryRuns(db, {});
      expect(runs.length).toBe(3);
    });

    it('should filter by run type', async () => {
      const runs = await queryRuns(db, { runType: 'path-only' });
      expect(runs.length).toBe(1);
      expect(runs[0].run_type).toBe('path-only');
    });

    it('should filter by status', async () => {
      const runs = await queryRuns(db, { status: 'completed' });
      expect(runs.length).toBe(2);
      runs.forEach((run) => expect(run.status).toBe('completed'));
    });

    it('should filter by git branch', async () => {
      const runs = await queryRuns(db, { gitBranch: 'main' });
      expect(runs.length).toBe(2);
      runs.forEach((run) => expect(run.git_branch).toBe('main'));
    });

    it('should limit results', async () => {
      const runs = await queryRuns(db, { limit: 2 });
      expect(runs.length).toBe(2);
    });
  });

  describe('getArtifactPath', () => {
    it('should return artifact path', async () => {
      const runId = `test-${randomUUID()}`;
      const runDir = await createRunDirectory(runId, 'path-only', {
        baseDir: TEST_BASE_DIR,
      });

      await runDir.writeArtifact('paths', [{ run_id: runId, value: 1 }]);
      await runDir.markSuccess();
      await registerRun(db, runDir.getRunDir());

      const artifactPath = await getArtifactPath(db, runId, 'paths');

      expect(artifactPath).toBeTruthy();
      expect(artifactPath).toContain('truth/paths.parquet');
    });

    it('should return null for non-existent artifact', async () => {
      const artifactPath = await getArtifactPath(db, 'non-existent-run', 'paths');
      expect(artifactPath).toBeNull();
    });
  });

  describe('getCatalogStats', () => {
    beforeEach(async () => {
      // Create test runs
      const runTypes = ['path-only', 'policy', 'path-only'];
      const statuses = ['completed', 'completed', 'failed'];

      for (let i = 0; i < 3; i++) {
        const runDir = await createRunDirectory(`test-${randomUUID()}`, runTypes[i] as any, {
          baseDir: TEST_BASE_DIR,
        });

        runDir.updateManifest({
          status: statuses[i] as any,
        });

        await runDir.writeArtifact('alerts', [{ call_id: 'call-1' }]);
        await runDir.writeArtifact('paths', [{ run_id: 'run-1' }]);

        if (statuses[i] === 'completed') {
          await runDir.markSuccess();
        } else {
          await runDir.markFailure(new Error('Test error'));
        }

        await registerRun(db, runDir.getRunDir());
      }
    });

    it('should return catalog statistics', async () => {
      const stats = await getCatalogStats(db);

      expect(stats.totalRuns).toBe(3);
      expect(stats.completedRuns).toBe(2);
      expect(stats.failedRuns).toBe(1);
      expect(stats.runsByType['path-only']).toBe(2);
      expect(stats.runsByType['policy']).toBe(1);
      expect(stats.totalArtifacts).toBe(6); // 3 runs * 2 artifacts each
      expect(stats.artifactsByType['alerts']).toBe(3);
      expect(stats.artifactsByType['paths']).toBe(3);
    });
  });
});

