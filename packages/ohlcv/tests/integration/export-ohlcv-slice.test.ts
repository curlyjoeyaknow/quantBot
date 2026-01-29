/**
 * Integration tests for OHLCV Slice Export
 *
 * These tests verify the full pipeline:
 * 1. Query ClickHouse for candles
 * 2. Validate coverage
 * 3. Write to Parquet
 * 4. Publish artifact
 * 5. Cleanup
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exportOhlcvSliceHandler } from '../../src/handlers/export-ohlcv-slice.js';
import type { ArtifactStorePort } from '@quantbot/core';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';

describe('exportOhlcvSlice (integration)', () => {
  let testDir: string;
  let mockArtifactStore: ArtifactStorePort;

  beforeAll(async () => {
    // Create temp directory for test artifacts
    testDir = join(tmpdir(), `ohlcv-export-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Mock artifact store
    mockArtifactStore = {
      publishArtifact: async (params) => {
        return {
          artifactId: `test-artifact-${Date.now()}`,
          deduped: false,
        };
      },
      getArtifact: async (artifactId) => {
        throw new Error('Not implemented in test');
      },
      findArtifacts: async (query) => {
        return [];
      },
      getArtifactLineage: async (artifactId) => {
        return {
          artifact: {} as any,
          inputs: [],
          outputs: [],
        };
      },
      getDownstreamArtifacts: async (artifactId) => {
        return [];
      },
    };
  });

  afterAll(async () => {
    // Cleanup test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it.skip('should export OHLCV slice from ClickHouse', async () => {
    // This test requires a running ClickHouse instance with data
    // Skip by default, enable for local testing

    const result = await exportOhlcvSliceHandler(
      {
        token: 'ABC123...',
        resolution: '1m',
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
        chain: 'solana',
      },
      mockArtifactStore
    );

    expect(result.artifactId).toBeDefined();
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.coverage.coveragePercent).toBeGreaterThan(0);
  });

  it.skip('should handle empty result set', async () => {
    // This test requires a running ClickHouse instance
    // Skip by default, enable for local testing

    const result = await exportOhlcvSliceHandler(
      {
        token: 'NONEXISTENT',
        resolution: '1m',
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
        chain: 'solana',
      },
      mockArtifactStore
    );

    expect(result.rowCount).toBe(0);
    expect(result.artifactId).toBeUndefined();
  });

  it.skip('should validate coverage and detect gaps', async () => {
    // This test requires a running ClickHouse instance with sparse data
    // Skip by default, enable for local testing

    const result = await exportOhlcvSliceHandler(
      {
        token: 'ABC123...',
        resolution: '1m',
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
        chain: 'solana',
      },
      mockArtifactStore
    );

    expect(result.coverage).toBeDefined();
    expect(result.coverage.expectedCandles).toBeGreaterThan(0);
    expect(result.coverage.actualCandles).toBeGreaterThanOrEqual(0);
    expect(result.coverage.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(result.coverage.coveragePercent).toBeLessThanOrEqual(100);
  });

  it.skip('should deduplicate artifacts', async () => {
    // This test requires a running ClickHouse instance and artifact store
    // Skip by default, enable for local testing

    // Export same slice twice
    const result1 = await exportOhlcvSliceHandler(
      {
        token: 'ABC123...',
        resolution: '1m',
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
        chain: 'solana',
      },
      mockArtifactStore
    );

    const result2 = await exportOhlcvSliceHandler(
      {
        token: 'ABC123...',
        resolution: '1m',
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
        chain: 'solana',
      },
      mockArtifactStore
    );

    // Second export should be deduped
    expect(result2.deduped).toBe(true);
    expect(result2.artifactId).toBe(result1.artifactId);
  });
});

