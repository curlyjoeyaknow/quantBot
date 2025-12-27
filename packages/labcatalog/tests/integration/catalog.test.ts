/**
 * Catalog integration tests
 *
 * Tests the full catalog API with a filesystem adapter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Catalog } from '../../src/catalog.js';
import { FileSystemCatalogAdapter } from '../../src/adapters.js';
import type { SliceManifestV1 } from '@quantbot/core';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

const TEST_CATALOG_DIR = join(process.cwd(), 'test-catalog');

describe('Catalog Integration', () => {
  let catalog: Catalog;

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_CATALOG_DIR)) {
      await rm(TEST_CATALOG_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_CATALOG_DIR, { recursive: true });

    // Create catalog instance
    const adapter = new FileSystemCatalogAdapter(TEST_CATALOG_DIR);
    catalog = new Catalog(adapter, TEST_CATALOG_DIR);
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_CATALOG_DIR)) {
      await rm(TEST_CATALOG_DIR, { recursive: true, force: true });
    }
  });

  describe('putSlice / getSlice', () => {
    it('should store and retrieve a slice manifest', async () => {
      const manifest: SliceManifestV1 = {
        version: 1,
        manifestId: '',
        createdAtIso: '2024-01-01T00:00:00Z',
        run: {
          runId: 'run-123',
          createdAtIso: '2024-01-01T00:00:00Z',
        },
        spec: {
          dataset: 'candles',
          chain: 'sol',
          timeRange: {
            startIso: '2024-01-01T00:00:00Z',
            endIso: '2024-01-02T00:00:00Z',
          },
          tokenIds: ['So11111111111111111111111111111111111111112'],
        },
        layout: {
          baseUri: 'file://./catalog',
          subdirTemplate: '{dataset}/chain={chain}',
        },
        parquetFiles: [
          {
            path: 'data/bars/So11111111111111111111111111111111111111112/20240101T000000_20240102T000000.parquet',
            rowCount: 100,
            byteSize: 1024,
          },
        ],
        summary: {
          totalFiles: 1,
          totalRows: 100,
          totalBytes: 1024,
        },
        integrity: {
          specHash: 'abc123',
        },
      };

      // Store slice
      const manifestId = await catalog.putSlice(manifest);

      expect(manifestId).toBeTruthy();
      expect(manifestId).toHaveLength(16);

      // Retrieve slice
      const retrieved = await catalog.getSlice(manifestId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.version).toBe(1);
      expect(retrieved?.spec.dataset).toBe('candles');
      expect(retrieved?.spec.chain).toBe('sol');
      expect(retrieved?.parquetFiles).toHaveLength(1);
    });

    it('should return null for non-existent manifest', async () => {
      const retrieved = await catalog.getSlice('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('putRun / getRun', () => {
    it('should store and retrieve a run manifest', async () => {
      const runId = 'run-123';
      const runData = {
        strategyId: 'PT2_SL25',
        strategyName: 'Profit Target 2, Stop Loss 25',
        status: 'completed' as const,
        callsSimulated: 100,
        callsSucceeded: 95,
        callsFailed: 5,
        summary: {
          avgPnl: 1.05,
          minPnl: 0.9,
          maxPnl: 1.2,
          totalTrades: 200,
          winRate: 0.65,
        },
        artifacts: {
          resultsParquet: 'runs/run-123/results.parquet',
          eventsNdjson: 'runs/run-123/events.ndjson',
        },
        tags: {
          experiment: 'test',
        },
      };

      // Store run
      const manifest = await catalog.putRun(runId, runData);

      expect(manifest.runId).toBe(runId);
      expect(manifest.status).toBe('completed');
      expect(manifest.callsSimulated).toBe(100);

      // Retrieve run
      const retrieved = await catalog.getRun(runId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.runId).toBe(runId);
      expect(retrieved?.strategyId).toBe('PT2_SL25');
      expect(retrieved?.summary.avgPnl).toBe(1.05);
      expect(retrieved?.tags?.experiment).toBe('test');
    });

    it('should return null for non-existent run', async () => {
      const retrieved = await catalog.getRun('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('listRuns', () => {
    it('should list all runs', async () => {
      // Create multiple runs
      await catalog.putRun('run-1', {
        strategyId: 'PT2_SL25',
        status: 'completed',
        callsSimulated: 10,
        callsSucceeded: 10,
        callsFailed: 0,
        summary: { totalTrades: 20 },
      });

      await catalog.putRun('run-2', {
        strategyId: 'PT3_SL30',
        status: 'completed',
        callsSimulated: 20,
        callsSucceeded: 20,
        callsFailed: 0,
        summary: { totalTrades: 40 },
      });

      await catalog.putRun('run-3', {
        strategyId: 'PT2_SL25',
        status: 'failed',
        callsSimulated: 5,
        callsSucceeded: 0,
        callsFailed: 5,
        summary: { totalTrades: 0 },
      });

      // List all runs
      const allRuns = await catalog.listRuns();

      expect(allRuns.length).toBeGreaterThanOrEqual(3);
      expect(allRuns.some((r) => r.runId === 'run-1')).toBe(true);
      expect(allRuns.some((r) => r.runId === 'run-2')).toBe(true);
    });

    it('should filter runs by strategyId', async () => {
      await catalog.putRun('run-1', {
        strategyId: 'PT2_SL25',
        status: 'completed',
        callsSimulated: 10,
        callsSucceeded: 10,
        callsFailed: 0,
        summary: { totalTrades: 20 },
      });

      await catalog.putRun('run-2', {
        strategyId: 'PT3_SL30',
        status: 'completed',
        callsSimulated: 20,
        callsSucceeded: 20,
        callsFailed: 0,
        summary: { totalTrades: 40 },
      });

      const filtered = await catalog.listRuns({ strategyId: 'PT2_SL25' });

      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(filtered.every((r) => r.strategyId === 'PT2_SL25')).toBe(true);
    });

    it('should filter runs by status', async () => {
      await catalog.putRun('run-1', {
        strategyId: 'PT2_SL25',
        status: 'completed',
        callsSimulated: 10,
        callsSucceeded: 10,
        callsFailed: 0,
        summary: { totalTrades: 20 },
      });

      await catalog.putRun('run-2', {
        strategyId: 'PT2_SL25',
        status: 'failed',
        callsSimulated: 5,
        callsSucceeded: 0,
        callsFailed: 5,
        summary: { totalTrades: 0 },
      });

      const completed = await catalog.listRuns({ status: 'completed' });
      expect(completed.every((r) => r.status === 'completed')).toBe(true);

      const failed = await catalog.listRuns({ status: 'failed' });
      expect(failed.every((r) => r.status === 'failed')).toBe(true);
    });

    it('should paginate results', async () => {
      // Create multiple runs
      for (let i = 0; i < 10; i++) {
        await catalog.putRun(`run-${i}`, {
          strategyId: 'PT2_SL25',
          status: 'completed',
          callsSimulated: 10,
          callsSucceeded: 10,
          callsFailed: 0,
          summary: { totalTrades: 20 },
        });
      }

      const page1 = await catalog.listRuns({ limit: 5 });
      expect(page1.length).toBe(5);

      const page2 = await catalog.listRuns({ limit: 5, offset: 5 });
      expect(page2.length).toBeGreaterThanOrEqual(5);
    });
  });
});
