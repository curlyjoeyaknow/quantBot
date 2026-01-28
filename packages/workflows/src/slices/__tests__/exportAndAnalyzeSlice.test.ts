import { describe, it, expect } from 'vitest';
import { exportAndAnalyzeSlice } from '../exportAndAnalyzeSlice.js';
import type { SliceExporter, SliceAnalyzer, SliceManifestV1 } from '@quantbot/core';

function makeStubManifest(overrides: Partial<SliceManifestV1> = {}): SliceManifestV1 {
  const base: SliceManifestV1 = {
    version: 1,
    manifestId: 'manifest_stub',
    createdAtIso: '2025-12-24T00:00:00.000Z',
    run: { runId: 'run_1', createdAtIso: '2025-12-24T00:00:00.000Z' },
    spec: {
      dataset: 'trades',
      chain: 'sol',
      timeRange: { startIso: '2025-12-01T00:00:00.000Z', endIso: '2025-12-02T00:00:00.000Z' },
    },
    layout: { baseUri: 'file:///tmp', subdirTemplate: '{dataset}/run_id={runId}' },
    parquetFiles: [{ path: 'file:///tmp/trades/run_id=run_1/part-000.parquet', rowCount: 123 }],
    summary: { totalFiles: 1, totalRows: 123 },
  };
  return { ...base, ...overrides };
}

describe('exportAndAnalyzeSlice', () => {
  it('orchestrates export then analyze (pure workflow)', async () => {
    const exporter: SliceExporter = {
      exportSlice: async () => makeStubManifest(),
    };

    const analyzer: SliceAnalyzer = {
      analyze: async ({ manifest }) => ({
        status: 'ok',
        summary: {
          exportedFiles: manifest.parquetFiles.length,
          exportedRows: manifest.summary.totalRows ?? null,
        },
      }),
    };

    const res = await exportAndAnalyzeSlice({
      run: { runId: 'run_1', createdAtIso: '2025-12-24T00:00:00.000Z' },
      spec: {
        dataset: 'trades',
        chain: 'sol',
        timeRange: { startIso: '2025-12-01T00:00:00.000Z', endIso: '2025-12-02T00:00:00.000Z' },
        tokenIds: [
          'So11111111111111111111111111111111111111112', // Valid Solana mint (44 chars)
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Valid Solana mint (44 chars)
        ],
        columns: ['ts', 'token_id', 'price', 'size'],
        tags: { purpose: 'feature_eng' },
      },
      layout: {
        baseUri: 'file:///tmp/slices',
        subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
        compression: 'zstd',
        maxRowsPerFile: 1_000_000,
        partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
      },
      analysis: { kind: 'sql', sql: 'select 1 as ok;' },
      exporter,
      analyzer,
      limits: { maxFiles: 100 },
    });

    expect(res.manifest.version).toBe(1);
    expect(res.analysis.status).toBe('ok');
    expect(res.analysis.summary?.exportedFiles).toBe(1);
  });

  it('enforces maxFiles limit', async () => {
    const exporter: SliceExporter = {
      exportSlice: async () =>
        makeStubManifest({
          parquetFiles: Array.from({ length: 3 }, (_, i) => ({
            path: `file:///tmp/part-${i}.parquet`,
          })),
          summary: { totalFiles: 3 },
        }),
    };

    const analyzer: SliceAnalyzer = {
      analyze: async () => ({ status: 'ok' }),
    };

    await expect(
      exportAndAnalyzeSlice({
        run: { runId: 'run_1', createdAtIso: '2025-12-24T00:00:00.000Z' },
        spec: {
          dataset: 'trades',
          chain: 'sol',
          timeRange: { startIso: '2025-12-01T00:00:00.000Z', endIso: '2025-12-02T00:00:00.000Z' },
        },
        layout: {
          baseUri: 'file:///tmp',
          subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
          compression: 'snappy',
          partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
        },
        analysis: { kind: 'sql', sql: 'select 1;' },
        exporter,
        analyzer,
        limits: { maxFiles: 2 },
      })
    ).rejects.toThrow(/Export produced too many files/);
  });
});
