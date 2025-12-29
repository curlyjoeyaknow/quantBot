/**
 * Unit tests for Artifact Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import {
  createArtifactDirectory,
  writeArtifact,
  writeCsvArtifact,
  type ArtifactPaths,
} from '../../../src/core/artifact-manager.js';
import type { RunIdComponents } from '../../../src/core/run-id-manager.js';

const TEST_ARTIFACTS_DIR = './test-artifacts';

describe('Artifact Manager', () => {
  beforeEach(async () => {
    // Clean up test artifacts directory
    if (existsSync(TEST_ARTIFACTS_DIR)) {
      await rm(TEST_ARTIFACTS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up test artifacts directory
    if (existsSync(TEST_ARTIFACTS_DIR)) {
      await rm(TEST_ARTIFACTS_DIR, { recursive: true, force: true });
    }
  });

  describe('createArtifactDirectory', () => {
    it('should create artifact directory structure', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components, TEST_ARTIFACTS_DIR);

      expect(paths.baseDir).toBe(TEST_ARTIFACTS_DIR);
      // runDir is an absolute or relative path, check it contains the base dir name
      expect(paths.runDir.replace(/^\.\//, '')).toContain(TEST_ARTIFACTS_DIR.replace(/^\.\//, ''));
      expect(existsSync(paths.runDir)).toBe(true);
      expect(existsSync(paths.resultsJson)).toBe(false); // File not created yet
      expect(paths.resultsJson).toContain('results.json');
      expect(paths.eventsCsv).toContain('events.csv');
      expect(paths.metricsJson).toContain('metrics.json');
      expect(paths.logsTxt).toContain('logs.txt');
    });

    it('should use default artifacts directory', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components);

      // Default uses getArtifactsDir() which returns ~/.cache/quantbot/artifacts
      expect(paths.baseDir).toBeTruthy();
      expect(paths.baseDir).toContain('artifacts');
      expect(existsSync(paths.runDir)).toBe(true);
    });

    it('should handle concurrent runs without collisions', async () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths1 = await createArtifactDirectory(base, TEST_ARTIFACTS_DIR);
      const paths2 = await createArtifactDirectory(
        { ...base, strategyId: 'PT3_SL30' },
        TEST_ARTIFACTS_DIR
      );

      expect(paths1.runDir).not.toBe(paths2.runDir);
      expect(existsSync(paths1.runDir)).toBe(true);
      expect(existsSync(paths2.runDir)).toBe(true);
    });
  });

  describe('writeArtifact', () => {
    it('should write JSON artifact', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components, TEST_ARTIFACTS_DIR);
      const data = { result: 'success', value: 42 };

      await writeArtifact(paths, 'resultsJson', data);

      expect(existsSync(paths.resultsJson)).toBe(true);
      const content = JSON.parse(readFileSync(paths.resultsJson, 'utf8'));
      expect(content).toEqual(data);
    });

    it('should write string artifact', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components, TEST_ARTIFACTS_DIR);
      const data = 'plain text log';

      await writeArtifact(paths, 'logsTxt', data);

      expect(existsSync(paths.logsTxt)).toBe(true);
      const content = readFileSync(paths.logsTxt, 'utf8');
      expect(content).toBe(data);
    });
  });

  describe('writeCsvArtifact', () => {
    it('should write CSV artifact with headers', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components, TEST_ARTIFACTS_DIR);
      const rows = [
        { event_type: 'entry', timestamp: 1704110400, price: 1.0 },
        { event_type: 'exit', timestamp: 1704110520, price: 2.0 },
      ];

      await writeCsvArtifact(paths, rows);

      expect(existsSync(paths.eventsCsv)).toBe(true);
      const content = readFileSync(paths.eventsCsv, 'utf8');
      expect(content).toContain('event_type,timestamp,price');
      expect(content).toContain('entry,1704110400,1');
      expect(content).toContain('exit,1704110520,2');
    });

    it('should handle empty rows', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components, TEST_ARTIFACTS_DIR);

      await writeCsvArtifact(paths, []);

      expect(existsSync(paths.eventsCsv)).toBe(true);
      const content = readFileSync(paths.eventsCsv, 'utf8');
      expect(content).toBe('');
    });

    it('should escape CSV values with commas', async () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const paths = await createArtifactDirectory(components, TEST_ARTIFACTS_DIR);
      const rows = [{ description: 'Entry, with comma', value: 1.0 }];

      await writeCsvArtifact(paths, rows);

      const content = readFileSync(paths.eventsCsv, 'utf8');
      expect(content).toContain('"Entry, with comma"');
    });
  });
});
