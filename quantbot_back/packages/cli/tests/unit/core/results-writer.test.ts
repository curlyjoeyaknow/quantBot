/**
 * Results Writer Tests
 *
 * Tests for standard results writing pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { ResultsWriter } from '../../../src/core/results-writer.js';

const TEST_DIR = join(process.cwd(), '.test-results-writer');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('ResultsWriter', () => {
  describe('initialize', () => {
    it('creates output directory', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      const config = { test: 'config' };

      await writer.initialize(outDir, config);

      expect(existsSync(outDir)).toBe(true);
    });

    it('pre-creates all output files', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      const config = { test: 'config' };

      await writer.initialize(outDir, config);
      const paths = writer.getPaths()!;

      expect(existsSync(paths.perCall)).toBe(true);
      expect(existsSync(paths.perCaller)).toBe(true);
      expect(existsSync(paths.errors)).toBe(true);
      expect(existsSync(paths.config)).toBe(true);
      expect(existsSync(paths.meta)).toBe(true);
    });

    it('writes config.json for provenance', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      const config = { test: 'config', nested: { value: 42 } };

      await writer.initialize(outDir, config);
      const paths = writer.getPaths()!;

      const savedConfig = JSON.parse(readFileSync(paths.config, 'utf-8'));
      expect(savedConfig).toEqual(config);
    });

    it('writes initial run.meta.json with placeholder values', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      const config = { test: 'config' };

      await writer.initialize(outDir, config);
      const paths = writer.getPaths()!;

      const meta = JSON.parse(readFileSync(paths.meta, 'utf-8'));
      expect(meta).toMatchObject({
        sweepId: expect.stringMatching(/^sweep-/),
        startedAtISO: expect.any(String),
        completedAtISO: '',
        durationMs: 0,
        gitSha: expect.any(String),
        configHash: expect.any(String),
        config: { test: 'config' },
        counts: {
          totalRuns: 0,
          totalResults: 0,
          totalCallerSummaries: 0,
        },
        completedScenarioIds: [],
      });
    });
  });

  describe('writePerCall', () => {
    it('appends row to per_call.jsonl', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      const row = { call: 'test', value: 42 };
      await writer.writePerCall(row);

      const paths = writer.getPaths()!;
      const content = readFileSync(paths.perCall, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]!)).toEqual(row);
    });

    it('increments per-call count', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      await writer.writePerCall({ test: 1 });
      await writer.writePerCall({ test: 2 });

      const counts = writer.getCounts();
      expect(counts.perCallRows).toBe(2);
    });

    it('throws if not initialized', async () => {
      const writer = new ResultsWriter();
      await expect(writer.writePerCall({ test: 1 })).rejects.toThrow(/not initialized/);
    });
  });

  describe('writePerCaller', () => {
    it('appends row to per_caller.jsonl', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      const row = { caller: 'test', value: 42 };
      await writer.writePerCaller(row);

      const paths = writer.getPaths()!;
      const content = readFileSync(paths.perCaller, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]!)).toEqual(row);
    });

    it('increments per-caller count', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      await writer.writePerCaller({ test: 1 });
      await writer.writePerCaller({ test: 2 });

      const counts = writer.getCounts();
      expect(counts.perCallerRows).toBe(2);
    });
  });

  describe('writeError', () => {
    it('appends error to errors.jsonl', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      const error = new Error('Test error');
      await writer.writeError(error);

      const paths = writer.getPaths()!;
      const content = readFileSync(paths.errors, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(1);
      const errorRow = JSON.parse(lines[0]!);
      expect(errorRow).toMatchObject({
        kind: 'error',
        error: {
          name: 'Error',
          message: 'Test error',
        },
        ts: expect.any(String),
      });
    });

    it('increments error count', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      await writer.writeError(new Error('Error 1'));
      await writer.writeError(new Error('Error 2'));

      const counts = writer.getCounts();
      expect(counts.errors).toBe(2);
    });
  });

  describe('writeMatrix', () => {
    it('writes matrix aggregation to matrix.json', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      const matrix = { key1: { value: 1 }, key2: { value: 2 } };
      await writer.writeMatrix(matrix);

      const paths = writer.getPaths()!;
      const savedMatrix = JSON.parse(readFileSync(paths.matrix, 'utf-8'));
      expect(savedMatrix).toEqual(matrix);
    });
  });

  describe('addCompletedScenario', () => {
    it('tracks completed scenario IDs', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      writer.addCompletedScenario('scenario-1');
      writer.addCompletedScenario('scenario-2');

      await writer.finalize();

      const paths = writer.getPaths()!;
      const meta = JSON.parse(readFileSync(paths.meta, 'utf-8'));
      expect(meta.completedScenarioIds).toEqual(['scenario-1', 'scenario-2']);
    });
  });

  describe('finalize', () => {
    it('writes final run.meta.json with counts and timings', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, { test: 'config' });

      await writer.writePerCall({ test: 1 });
      await writer.writePerCall({ test: 2 });
      await writer.writePerCaller({ test: 1 });

      await writer.finalize({ counts: { totalRuns: 5 } });

      const paths = writer.getPaths()!;
      const meta = JSON.parse(readFileSync(paths.meta, 'utf-8'));

      expect(meta).toMatchObject({
        sweepId: expect.stringMatching(/^sweep-/),
        startedAtISO: expect.any(String),
        completedAtISO: expect.any(String),
        durationMs: expect.any(Number),
        gitSha: expect.any(String),
        configHash: expect.any(String),
        config: { test: 'config' },
        counts: {
          totalRuns: 5,
          totalResults: 2,
          totalCallerSummaries: 1,
        },
        completedScenarioIds: [],
      });

      expect(meta.durationMs).toBeGreaterThan(0);
    });

    it('includes diagnostics if provided', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      await writer.finalize({
        counts: { totalRuns: 5 },
        diagnostics: { errors: 2, warnings: 3 },
      });

      const paths = writer.getPaths()!;
      const meta = JSON.parse(readFileSync(paths.meta, 'utf-8'));

      expect(meta.diagnostics).toEqual({ errors: 2, warnings: 3 });
    });

    it('returns artifact paths and counts', async () => {
      const outDir = join(TEST_DIR, 'run-001');
      const writer = new ResultsWriter();
      await writer.initialize(outDir, {});

      await writer.writePerCall({ test: 1 });
      await writer.writePerCaller({ test: 1 });

      const result = await writer.finalize();

      expect(result.paths).toMatchObject({
        outDir,
        perCall: expect.stringContaining('per_call.jsonl'),
        perCaller: expect.stringContaining('per_caller.jsonl'),
        matrix: expect.stringContaining('matrix.json'),
        errors: expect.stringContaining('errors.jsonl'),
        meta: expect.stringContaining('run.meta.json'),
        config: expect.stringContaining('config.json'),
      });

      expect(result.counts).toEqual({
        perCallRows: 1,
        perCallerRows: 1,
        errors: 0,
      });
    });

    it('throws if not initialized', async () => {
      const writer = new ResultsWriter();
      await expect(writer.finalize()).rejects.toThrow(/not initialized/);
    });
  });
});
