/**
 * Integration tests for slice export
 *
 * Tests the ClickHouse exporter with real data.
 * Uses 2025 dates in examples.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { exportAndAnalyzeSlice } from '../../src/slices/exportAndAnalyzeSlice.js';
import { createClickHouseSliceExporterAdapterImpl } from '@quantbot/storage';
import { createDuckDbSliceAnalyzerAdapterImpl } from '@quantbot/storage';
import { createSliceValidatorAdapter } from '@quantbot/storage';
import { generateTestRunId, getTestOutputDir } from './helpers/test-fixtures.js';
import { shouldRunDbStress } from '@quantbot/utils/test-helpers/test-gating';
import type {
  SliceSpec,
  ParquetLayoutSpec,
  RunContext,
  AnalysisSpec,
} from '../../src/slices/types.js';

// Gate these tests behind RUN_DB_STRESS=1 - they require ClickHouse with real data
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)('Slice Export Integration Tests', () => {
  const outputDir = getTestOutputDir();
  let testRunId: string;

  beforeAll(async () => {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    testRunId = generateTestRunId('integration');
  });

  afterAll(async () => {
    // Cleanup: remove test output directory
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should export real candles_1m data from ClickHouse', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();
    const validator = createSliceValidatorAdapter();

    const run: RunContext = {
      runId: testRunId,
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-01T00:00:00.000Z',
        endIso: '2025-12-02T00:00:00.000Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT COUNT(*) as total_rows FROM slice',
    };

    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
    });

    // Verify manifest
    expect(result.manifest).toBeDefined();
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.run.runId).toBe(testRunId);
    expect(result.manifest.spec.dataset).toBe('candles_1m');
    expect(result.manifest.parquetFiles.length).toBeGreaterThan(0);

    // Verify Parquet file exists
    const firstFile = result.manifest.parquetFiles[0];
    const filePath = firstFile.path.replace(/^file:\/\//, '');
    const fileExists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // Verify manifest via validator
    const validation = await validator.validate(result.manifest);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Verify analysis result
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();
  }, 60000); // 60 second timeout for real ClickHouse query

  it('should export real candles_1s data from ClickHouse', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('1s'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1s',
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-01T00:00:00.000Z',
        endIso: '2025-12-01T01:00:00.000Z', // 1 hour for 1s data (smaller window)
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT COUNT(*) as total_rows FROM slice',
    };

    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
    });

    // Verify manifest
    expect(result.manifest).toBeDefined();
    expect(result.manifest.spec.dataset).toBe('candles_1s');
    expect(result.manifest.parquetFiles.length).toBeGreaterThan(0);

    // Verify analysis result
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();
  }, 60000);

  it('should export real candles_15s data from ClickHouse', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('15s'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_15s',
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-01T00:00:00.000Z',
        endIso: '2025-12-01T12:00:00.000Z', // 12 hours for 15s data
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT COUNT(*) as total_rows FROM slice',
    };

    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
    });

    // Verify manifest
    expect(result.manifest).toBeDefined();
    expect(result.manifest.spec.dataset).toBe('candles_15s');
    expect(result.manifest.parquetFiles.length).toBeGreaterThan(0);

    // Verify analysis result
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();
  }, 60000);

  it('should handle empty result set gracefully', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('empty'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        // Use a time range that likely has no data (far future)
        startIso: '2030-01-01T00:00:00.000Z',
        endIso: '2030-01-02T00:00:00.000Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT COUNT(*) as total_rows FROM slice',
    };

    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
    });

    // Should return empty manifest, not error
    expect(result.manifest).toBeDefined();
    expect(result.manifest.parquetFiles.length).toBe(0);
    expect(result.manifest.summary.totalFiles).toBe(0);
  }, 60000);

  it('should validate time range (start < end)', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('invalid'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-02T00:00:00.000Z',
        endIso: '2025-12-01T00:00:00.000Z', // Invalid: end before start
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT 1',
    };

    await expect(
      exportAndAnalyzeSlice({
        run,
        spec,
        layout,
        analysis,
        exporter,
        analyzer,
      })
    ).rejects.toThrow(/startIso.*must be before endIso/);
  });

  it('should enforce max 90 days limit', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('maxdays'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-01-01T00:00:00.000Z',
        endIso: '2025-04-01T00:00:00.000Z', // 90+ days
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT 1',
    };

    await expect(
      exportAndAnalyzeSlice({
        run,
        spec,
        layout,
        analysis,
        exporter,
        analyzer,
      })
    ).rejects.toThrow(/exceeds maximum of 90 days/);
  });

  it('should reject unsupported datasets', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('unsupported'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_5m', // Not yet supported
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-01T00:00:00.000Z',
        endIso: '2025-12-02T00:00:00.000Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT 1',
    };

    await expect(
      exportAndAnalyzeSlice({
        run,
        spec,
        layout,
        analysis,
        exporter,
        analyzer,
      })
    ).rejects.toThrow(/Unsupported dataset.*candles_5m/);
  });

  it('should validate token address format', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('tokens'),
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-01T00:00:00.000Z',
        endIso: '2025-12-02T00:00:00.000Z',
      },
      tokenIds: ['invalid'], // Too short
    };

    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT 1',
    };

    await expect(
      exportAndAnalyzeSlice({
        run,
        spec,
        layout,
        analysis,
        exporter,
        analyzer,
      })
    ).rejects.toThrow(/tokenId must be 32-44 characters/);
  });
});
