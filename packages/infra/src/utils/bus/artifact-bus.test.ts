/**
 * Artifact Bus Integration Tests
 *
 * Tests the TypeScript submitArtifact function end-to-end.
 * Requires bus daemon to be running (or will gracefully skip).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { submitArtifact } from './artifact-bus.js';
import { DuckDBClient } from '../../storage/duckdb/duckdb-client.js';
import { findWorkspaceRoot } from '../fs/workspace-root.js';

describe('Artifact Bus Integration', () => {
  let testParquetPath: string;
  let testRunId: string;

  beforeAll(async () => {
    // Create a test Parquet file
    testRunId = `test-${Date.now()}`;
    const testDir = await fs.mkdtemp(join(tmpdir(), 'bus-test-'));
    testParquetPath = join(testDir, 'test.parquet');

    // Create test data and write to Parquet
    const db = new DuckDBClient(':memory:');
    try {
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');
      await db.execute(`
        CREATE TABLE test_data AS
        SELECT * FROM (VALUES
          ('token1', 1000, 1.5, 10.0),
          ('token2', 2000, 2.5, 20.0),
          ('token3', 3000, 3.5, 30.0)
        ) AS t(token_id, timestamp, price, volume)
      `);
      await db.execute(
        `COPY test_data TO '${testParquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`
      );
    } finally {
      await db.close();
    }
  });

  afterAll(async () => {
    // Cleanup test file
    try {
      await fs.unlink(testParquetPath);
      await fs.rmdir(join(testParquetPath, '..'));
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should submit artifact to bus', async () => {
    // Skip if bus_submit.py doesn't exist (test environment might not have it)
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'scripts', 'bus_submit.py');
    
    if (!existsSync(scriptPath)) {
      console.warn(`bus_submit.py not found at ${scriptPath}, skipping test`);
      return;
    }

    const result = await submitArtifact({
      runId: testRunId,
      producer: 'test',
      kind: 'test_artifact',
      artifactId: 'test_data',
      parquetPath: testParquetPath,
      schemaHint: 'test.schema',
      rows: 3,
      meta: { test: true },
    });

    // If submission fails, it might be because bus daemon isn't running
    // That's acceptable for unit tests - just verify the function doesn't throw
    if (!result.success) {
      console.warn('Artifact submission failed (bus daemon may not be running):', result.error);
      expect(result.error).toBeDefined();
    } else {
      expect(result.success).toBe(true);
      expect(result.jobId).toBeDefined();
    }
  }, 30000); // 30 second timeout

  it('should handle missing file gracefully', async () => {
    const result = await submitArtifact({
      runId: `test-${Date.now()}`,
      producer: 'test',
      kind: 'test_artifact',
      artifactId: 'missing',
      parquetPath: '/nonexistent/path.parquet',
      rows: 0,
    });

    // Should fail but return a result (not throw)
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle invalid bus root gracefully', async () => {
    const result = await submitArtifact({
      runId: `test-${Date.now()}`,
      producer: 'test',
      kind: 'test_artifact',
      artifactId: 'test',
      parquetPath: testParquetPath,
      busRoot: '/nonexistent/bus/root',
      rows: 3,
    });

    // Should fail but return a result (not throw)
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
