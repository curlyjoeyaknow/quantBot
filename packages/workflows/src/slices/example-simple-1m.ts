/**
 * Simple example: Export 1m OHLCV candles slice
 *
 * This is the simplest starting point:
 * - One dataset: "candles_1m"
 * - One filter mode: time range + optional tokenIds
 * - One Parquet file output
 */

import { exportAndAnalyzeSlice } from './exportAndAnalyzeSlice.js';
import {
  createClickHouseSliceExporterAdapterImpl,
  createDuckDbSliceAnalyzerAdapterImpl,
} from '@quantbot/infra/storage';

async function exampleExport1mCandles() {
  const exporter = createClickHouseSliceExporterAdapterImpl();
  const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

  const result = await exportAndAnalyzeSlice({
    run: {
      runId: 'example_run_001',
      createdAtIso: new Date().toISOString(),
      note: 'Simple 1m candles export example',
    },
    spec: {
      dataset: 'candles_1m', // Maps to ohlcv_candles table with interval='1m'
      chain: 'sol',
      timeRange: {
        startIso: '2024-12-01T00:00:00.000Z',
        endIso: '2024-12-02T00:00:00.000Z',
      },
      // Optional: filter to specific tokens
      // tokenIds: ['So11111111111111111111111111111111111111112', '...'],
      granularity: '1m',
      tags: {
        purpose: 'example',
        interval: '1m',
      },
    },
    layout: {
      baseUri: 'file:///tmp/slices',
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
      compression: 'snappy',
      maxRowsPerFile: 1_000_000,
      partitionKeys: ['dataset', 'chain', 'runId', 'dt'],
    },
    analysis: {
      kind: 'sql',
      sql: `
        SELECT 
          COUNT(*) as total_candles,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(timestamp) as first_ts,
          MAX(timestamp) as last_ts,
          AVG(volume) as avg_volume
        FROM slice
      `,
    },
    exporter,
    analyzer,
    limits: {
      maxFiles: 10, // Safety limit
    },
  });

  console.log('Export completed:', {
    success: result.manifest.summary.totalFiles > 0,
    files: result.manifest.summary.totalFiles,
    rows: result.manifest.summary.totalRows,
    manifestPath: result.manifest.parquetFiles[0]?.path.replace(/\/[^/]+$/, '/slice.manifest.json'),
  });

  return result;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleExport1mCandles().catch(console.error);
}

export { exampleExport1mCandles };
