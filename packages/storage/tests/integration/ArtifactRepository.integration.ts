/**
 * Integration tests for ArtifactRepository
 *
 * Tests artifact discovery and metadata retrieval from file system.
 * Uses temporary directories for testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ArtifactRepository } from '../../src/duckdb/repositories/ArtifactRepository.js';

describe('ArtifactRepository Integration', () => {
  let testDir: string;
  let repo: ArtifactRepository;

  beforeEach(async () => {
    // Create temporary directory for each test
    testDir = join(tmpdir(), `artifacts-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    repo = new ArtifactRepository(testDir);
  });

  afterEach(async () => {
    // Cleanup temporary directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getByRunId', () => {
    it('should discover Parquet files', async () => {
      const runDir = join(testDir, 'run-1');
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'events.parquet'), 'parquet data');

      const artifacts = await repo.getByRunId('run-1');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      const parquetArtifact = artifacts.find((a) => a.type === 'parquet');
      expect(parquetArtifact).toBeDefined();
      expect(parquetArtifact?.path).toContain('events.parquet');
    });

    it('should discover CSV files', async () => {
      const runDir = join(testDir, 'run-2');
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'summary.csv'), 'csv,data\n1,2');

      const artifacts = await repo.getByRunId('run-2');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      const csvArtifact = artifacts.find((a) => a.type === 'csv');
      expect(csvArtifact).toBeDefined();
      expect(csvArtifact?.path).toContain('summary.csv');
    });

    it('should discover JSON files', async () => {
      const runDir = join(testDir, 'run-3');
      await mkdir(runDir, { recursive: true });
      // Use expected file name from repository
      await writeFile(join(runDir, 'manifest.json'), '{"key":"value"}');

      const artifacts = await repo.getByRunId('run-3');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      const jsonArtifact = artifacts.find((a) => a.type === 'json');
      expect(jsonArtifact).toBeDefined();
      expect(jsonArtifact?.path).toContain('manifest.json');
    });

    it('should discover NDJSON files', async () => {
      const runDir = join(testDir, 'run-4');
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'events.ndjson'), '{"event":"1"}\n{"event":"2"}');

      const artifacts = await repo.getByRunId('run-4');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      const ndjsonArtifact = artifacts.find((a) => a.type === 'ndjson');
      expect(ndjsonArtifact).toBeDefined();
      expect(ndjsonArtifact?.path).toContain('events.ndjson');
    });

    it('should discover log files', async () => {
      const runDir = join(testDir, 'run-5');
      await mkdir(runDir, { recursive: true });
      // Use expected file name from repository
      await writeFile(join(runDir, 'debug.log'), 'log content');

      const artifacts = await repo.getByRunId('run-5');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      const logArtifact = artifacts.find((a) => a.type === 'log');
      expect(logArtifact).toBeDefined();
      expect(logArtifact?.path).toContain('debug.log');
    });

    it('should return multiple artifacts', async () => {
      const runDir = join(testDir, 'run-6');
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'events.parquet'), 'parquet');
      await writeFile(join(runDir, 'summary.csv'), 'csv');
      await writeFile(join(runDir, 'manifest.json'), '{}');

      const artifacts = await repo.getByRunId('run-6');

      expect(artifacts.length).toBeGreaterThanOrEqual(3);
      expect(artifacts.some((a) => a.type === 'parquet')).toBe(true);
      expect(artifacts.some((a) => a.type === 'csv')).toBe(true);
      expect(artifacts.some((a) => a.type === 'json')).toBe(true);
    });

    it('should return artifact metadata', async () => {
      const runDir = join(testDir, 'run-7');
      await mkdir(runDir, { recursive: true });
      // Use expected file name from repository
      const filePath = join(runDir, 'events.parquet');
      await writeFile(filePath, 'test data');

      const artifacts = await repo.getByRunId('run-7');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      const artifact = artifacts[0];
      expect(artifact.type).toBeDefined();
      expect(artifact.path).toBeDefined();
      expect(artifact.size).toBeGreaterThan(0);
      expect(artifact.createdAt).toBeDefined();
    });

    it('should handle non-existent run directories', async () => {
      const artifacts = await repo.getByRunId('non-existent');

      expect(artifacts).toEqual([]);
    });

    it('should handle empty run directories', async () => {
      const runDir = join(testDir, 'run-8');
      await mkdir(runDir, { recursive: true });

      const artifacts = await repo.getByRunId('run-8');

      expect(artifacts).toEqual([]);
    });
  });
});
