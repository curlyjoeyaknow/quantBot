/**
 * RunDirectory Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunDirectory, createRunDirectory, listRunDirectories, getGitProvenance } from './writer.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const TEST_BASE_DIR = 'test-runs';

describe('RunDirectory', () => {
  let testRunId: string;
  let runDir: RunDirectory;

  beforeEach(async () => {
    testRunId = `test-${randomUUID()}`;
    runDir = new RunDirectory(testRunId, 'path-only', { baseDir: TEST_BASE_DIR });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('constructor', () => {
    it('should create RunDirectory with month partition', () => {
      const dir = new RunDirectory('test-run-123', 'path-only', {
        baseDir: TEST_BASE_DIR,
        partitionByMonth: true,
      });

      const runDirPath = dir.getRunDir();
      expect(runDirPath).toMatch(/test-runs\/\d{4}-\d{2}\/run_id=test-run-123/);
    });

    it('should create RunDirectory without month partition', () => {
      const dir = new RunDirectory('test-run-123', 'path-only', {
        baseDir: TEST_BASE_DIR,
        partitionByMonth: false,
      });

      const runDirPath = dir.getRunDir();
      expect(runDirPath).toBe('test-runs/run_id=test-run-123');
    });

    it('should initialize manifest with correct defaults', () => {
      const dir = new RunDirectory('test-run-123', 'policy');
      const manifest = (dir as any).manifest;

      expect(manifest.run_id).toBe('test-run-123');
      expect(manifest.run_type).toBe('policy');
      expect(manifest.status).toBe('pending');
      expect(manifest.schema_version.manifest).toBe('1.0.0');
      expect(manifest.schema_version.artifacts).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('should create directory structure', async () => {
      await runDir.initialize();

      const runDirPath = runDir.getRunDir();
      expect(await fs.stat(join(runDirPath, 'inputs'))).toBeTruthy();
      expect(await fs.stat(join(runDirPath, 'truth'))).toBeTruthy();
      expect(await fs.stat(join(runDirPath, 'features'))).toBeTruthy();
      expect(await fs.stat(join(runDirPath, 'policy'))).toBeTruthy();
      expect(await fs.stat(join(runDirPath, 'results'))).toBeTruthy();
      expect(await fs.stat(join(runDirPath, 'logs'))).toBeTruthy();
      expect(await fs.stat(join(runDirPath, 'errors'))).toBeTruthy();
    });

    it('should write initial manifest', async () => {
      await runDir.initialize();

      const manifestPath = join(runDir.getRunDir(), 'run.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.run_id).toBe(testRunId);
      expect(manifest.status).toBe('running');
      expect(manifest.started_at).toBeTruthy();
    });
  });

  describe('writeArtifact', () => {
    beforeEach(async () => {
      await runDir.initialize();
    });

    it('should write artifact to correct subdirectory', async () => {
      const data = [
        { call_id: 'call-1', mint: 'mint-1', caller_name: 'alice' },
        { call_id: 'call-2', mint: 'mint-2', caller_name: 'bob' },
      ];

      const filepath = await runDir.writeArtifact('alerts', data);

      expect(filepath).toContain('inputs/alerts.parquet');
      expect(await fs.stat(filepath)).toBeTruthy();
    });

    it('should update manifest with artifact info', async () => {
      const data = [
        { call_id: 'call-1', value: 100 },
        { call_id: 'call-2', value: 200 },
      ];

      await runDir.writeArtifact('paths', data);

      const manifestPath = join(runDir.getRunDir(), 'run.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.artifacts.paths).toBeTruthy();
      expect(manifest.artifacts.paths.rows).toBe(2);
      expect(manifest.artifacts.paths.path).toBe('truth/paths.parquet');
    });

    it('should skip empty artifacts', async () => {
      const filepath = await runDir.writeArtifact('errors', []);

      expect(filepath).toBe('');
    });

    it('should handle various data types', async () => {
      const data = [
        {
          string_col: 'test',
          number_col: 123,
          boolean_col: true,
          null_col: null,
        },
      ];

      const filepath = await runDir.writeArtifact('summary', data);

      expect(await fs.stat(filepath)).toBeTruthy();
    });
  });

  describe('updateManifest', () => {
    beforeEach(async () => {
      await runDir.initialize();
    });

    it('should update manifest fields', () => {
      runDir.updateManifest({
        git_commit: 'abc123',
        git_branch: 'main',
        git_dirty: false,
      });

      const manifest = (runDir as any).manifest;
      expect(manifest.git_commit).toBe('abc123');
      expect(manifest.git_branch).toBe('main');
      expect(manifest.git_dirty).toBe(false);
    });

    it('should merge updates with existing manifest', () => {
      runDir.updateManifest({
        git_commit: 'abc123',
      });

      runDir.updateManifest({
        git_branch: 'main',
      });

      const manifest = (runDir as any).manifest;
      expect(manifest.git_commit).toBe('abc123');
      expect(manifest.git_branch).toBe('main');
    });
  });

  describe('markSuccess', () => {
    beforeEach(async () => {
      await runDir.initialize();
    });

    it('should update status to completed', async () => {
      await runDir.markSuccess();

      const manifestPath = join(runDir.getRunDir(), 'run.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.status).toBe('completed');
      expect(manifest.completed_at).toBeTruthy();
    });

    it('should write _SUCCESS marker', async () => {
      await runDir.markSuccess();

      const successPath = join(runDir.getRunDir(), '_SUCCESS');
      expect(await fs.stat(successPath)).toBeTruthy();
    });

    it('should calculate total timing', async () => {
      runDir.updateManifest({
        timing: {
          plan_ms: 100,
          coverage_ms: 200,
          slice_ms: 300,
          execution_ms: 400,
        },
      });

      await runDir.markSuccess();

      const manifestPath = join(runDir.getRunDir(), 'run.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.timing.total_ms).toBe(1000);
    });
  });

  describe('markFailure', () => {
    beforeEach(async () => {
      await runDir.initialize();
    });

    it('should update status to failed', async () => {
      const error = new Error('Test error');
      await runDir.markFailure(error);

      const manifestPath = join(runDir.getRunDir(), 'run.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.status).toBe('failed');
      expect(manifest.completed_at).toBeTruthy();
    });

    it('should write error to stderr log', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:123';

      await runDir.markFailure(error);

      const stderrPath = join(runDir.getRunDir(), 'logs', 'stderr.txt');
      const stderrContent = await fs.readFile(stderrPath, 'utf-8');

      expect(stderrContent).toContain('Test error');
    });
  });

  describe('readManifest', () => {
    beforeEach(async () => {
      await runDir.initialize();
    });

    it('should read manifest from disk', async () => {
      runDir.updateManifest({
        git_commit: 'abc123',
        git_branch: 'main',
      });
      await runDir.writeManifest();

      const manifest = await RunDirectory.readManifest(runDir.getRunDir());

      expect(manifest.run_id).toBe(testRunId);
      expect(manifest.git_commit).toBe('abc123');
      expect(manifest.git_branch).toBe('main');
    });
  });

  describe('isComplete', () => {
    beforeEach(async () => {
      await runDir.initialize();
    });

    it('should return false for incomplete run', async () => {
      const isComplete = await RunDirectory.isComplete(runDir.getRunDir());
      expect(isComplete).toBe(false);
    });

    it('should return true for complete run', async () => {
      await runDir.markSuccess();

      const isComplete = await RunDirectory.isComplete(runDir.getRunDir());
      expect(isComplete).toBe(true);
    });
  });
});

describe('createRunDirectory', () => {
  afterEach(async () => {
    try {
      await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  it('should create and initialize run directory', async () => {
    const runId = `test-${randomUUID()}`;
    const runDir = await createRunDirectory(runId, 'path-only', { baseDir: TEST_BASE_DIR });

    const runDirPath = runDir.getRunDir();
    expect(await fs.stat(runDirPath)).toBeTruthy();
    expect(await fs.stat(join(runDirPath, 'run.json'))).toBeTruthy();
  });
});

describe('listRunDirectories', () => {
  afterEach(async () => {
    try {
      await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  it('should list all run directories', async () => {
    // Create 3 runs
    const runDir1 = await createRunDirectory(`test-${randomUUID()}`, 'path-only', {
      baseDir: TEST_BASE_DIR,
    });
    const runDir2 = await createRunDirectory(`test-${randomUUID()}`, 'policy', {
      baseDir: TEST_BASE_DIR,
    });
    const runDir3 = await createRunDirectory(`test-${randomUUID()}`, 'optimization', {
      baseDir: TEST_BASE_DIR,
    });

    await runDir1.markSuccess();
    await runDir2.markSuccess();
    // Leave runDir3 incomplete

    const allRuns = await listRunDirectories(TEST_BASE_DIR, false);
    expect(allRuns.length).toBe(3);

    const completeRuns = await listRunDirectories(TEST_BASE_DIR, true);
    expect(completeRuns.length).toBe(2);
  });

  it('should return empty array for non-existent directory', async () => {
    const runs = await listRunDirectories('non-existent-dir');
    expect(runs).toEqual([]);
  });
});

describe('getGitProvenance', () => {
  it('should return git info if in git repo', async () => {
    const gitInfo = await getGitProvenance();

    // May or may not be in git repo depending on test environment
    if (gitInfo.commit) {
      expect(gitInfo.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(gitInfo.branch).toBeTruthy();
      expect(typeof gitInfo.dirty).toBe('boolean');
    }
  });
});

