/**
 * End-to-End Tests for Slice Export & Analyze Pipeline
 *
 * Tests the complete flow from ClickHouse export through DuckDB analysis.
 * This is a full integration test that exercises:
 * 1. ClickHouse query and Parquet export
 * 2. Manifest generation
 * 3. DuckDB analysis with SQL queries
 * 4. Validation of results
 *
 * Uses real ClickHouse data and verifies the entire pipeline works correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { exportAndAnalyzeSlice } from '../../src/slices/exportAndAnalyzeSlice.js';
import { createClickHouseSliceExporterAdapterImpl } from '@quantbot/storage';
import { createDuckDbSliceAnalyzerAdapterImpl } from '@quantbot/storage';
import { createSliceValidatorAdapter } from '@quantbot/storage';
import { generateTestRunId, getTestOutputDir } from './helpers/test-fixtures.js';
import type {
  SliceSpec,
  ParquetLayoutSpec,
  RunContext,
  AnalysisSpec,
  ExportAndAnalyzeResult,
} from '../../src/slices/types.js';

describe('Slice Export & Analyze E2E Tests', () => {
  const outputDir = getTestOutputDir();
  let testRunId: string;

  beforeAll(async () => {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    testRunId = generateTestRunId('e2e');
  });

  afterAll(async () => {
    // Cleanup: remove test output directory
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('E2E: should complete full pipeline: export → manifest → analyze → validate', async () => {
    // Setup: Create adapters
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();
    const validator = createSliceValidatorAdapter();

    // Setup: Define run context
    const run: RunContext = {
      runId: testRunId,
      createdAtIso: new Date().toISOString(),
      note: 'E2E test run',
    };

    // Setup: Define slice spec (1 day of candles_1m data)
    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-12-01T00:00:00.000Z',
        endIso: '2025-12-02T00:00:00.000Z',
      },
    };

    // Setup: Define layout
    const layout: ParquetLayoutSpec = {
      baseUri: `file://${outputDir}`,
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    };

    // Setup: Define analysis (multiple SQL queries to test different scenarios)
    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: `
        SELECT 
          COUNT(*) as total_rows,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(timestamp) as min_timestamp,
          MAX(timestamp) as max_timestamp,
          AVG(volume) as avg_volume,
          SUM(volume) as total_volume
        FROM slice
      `,
    };

    // Execute: Run full pipeline
    const result: ExportAndAnalyzeResult = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
      limits: {
        maxTimeRangeDays: 90,
        maxFiles: 100,
      },
    });

    // Assert: Manifest structure
    expect(result.manifest).toBeDefined();
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.manifestId).toBeDefined();
    expect(result.manifest.createdAtIso).toBeDefined();
    expect(result.manifest.run.runId).toBe(testRunId);
    expect(result.manifest.run.note).toBe('E2E test run');
    expect(result.manifest.spec).toEqual(spec);
    expect(result.manifest.layout).toEqual(layout);

    // Assert: Parquet files exist and are valid
    expect(result.manifest.parquetFiles.length).toBeGreaterThan(0);
    for (const file of result.manifest.parquetFiles) {
      expect(file.path).toBeDefined();
      expect(file.path).toMatch(/^file:\/\//);

      // Verify file exists on disk
      const filePath = file.path.replace(/^file:\/\//, '');
      const fileExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file has metadata
      if (file.rowCount !== undefined) {
        expect(file.rowCount).toBeGreaterThanOrEqual(0);
      }
      if (file.byteSize !== undefined) {
        expect(file.byteSize).toBeGreaterThan(0);
      }
    }

    // Assert: Summary statistics
    expect(result.manifest.summary).toBeDefined();
    expect(result.manifest.summary.totalFiles).toBe(result.manifest.parquetFiles.length);
    if (result.manifest.summary.totalRows !== undefined) {
      expect(result.manifest.summary.totalRows).toBeGreaterThanOrEqual(0);
    }
    if (result.manifest.summary.totalBytes !== undefined) {
      expect(result.manifest.summary.totalBytes).toBeGreaterThan(0);
    }

    // Assert: Integrity hashes
    expect(result.manifest.integrity).toBeDefined();
    expect(result.manifest.integrity?.specHash).toBeDefined();

    // Assert: Analysis result
    expect(result.analysis).toBeDefined();
    if (result.analysis.status !== 'ok') {
      const errorMsg = `Analysis failed with status '${result.analysis.status}'. Warnings: ${JSON.stringify(result.analysis.warnings || [])}. Summary: ${JSON.stringify(result.analysis.summary || {})}`;
      throw new Error(errorMsg);
    }
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();

    // Verify analysis summary contains expected fields
    const summary = result.analysis.summary!;
    expect(summary.total_rows).toBeDefined();
    expect(typeof summary.total_rows).toBe('number');
    expect(summary.unique_tokens).toBeDefined();
    expect(typeof summary.unique_tokens).toBe('number');
    expect(summary.min_timestamp).toBeDefined();
    expect(summary.max_timestamp).toBeDefined();
    expect(summary.avg_volume).toBeDefined();
    expect(summary.total_volume).toBeDefined();

    // Assert: Analysis summary values are reasonable
    expect(summary.total_rows as number).toBeGreaterThanOrEqual(0);
    expect(summary.unique_tokens as number).toBeGreaterThanOrEqual(0);
    if ((summary.total_rows as number) > 0) {
      expect(summary.unique_tokens as number).toBeGreaterThan(0);
      expect(summary.min_timestamp).toBeDefined();
      expect(summary.max_timestamp).toBeDefined();
    }

    // Execute: Validate manifest using validator
    const validation = await validator.validate(result.manifest);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Assert: Manifest file exists on disk
    const manifestPath = join(
      outputDir,
      'candles_1m',
      'chain=sol',
      'dt=2025-12-01',
      `run_id=${testRunId}`,
      'slice.manifest.json'
    );
    const manifestExists = await fs
      .access(manifestPath)
      .then(() => true)
      .catch(() => false);
    expect(manifestExists).toBe(true);

    // Assert: Manifest file content matches returned manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const savedManifest = JSON.parse(manifestContent);
    expect(savedManifest.version).toBe(result.manifest.version);
    expect(savedManifest.manifestId).toBe(result.manifest.manifestId);
    expect(savedManifest.run.runId).toBe(result.manifest.run.runId);
  }, 120000); // 2 minute timeout for full E2E test

  it('E2E: should handle complex SQL analysis queries', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('e2e-complex'),
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

    // Complex analysis: group by token, calculate statistics
    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: `
        SELECT 
          token_address,
          COUNT(*) as candle_count,
          MIN(timestamp) as first_candle,
          MAX(timestamp) as last_candle,
          AVG(close) as avg_close,
          MAX(high) as max_high,
          MIN(low) as min_low,
          SUM(volume) as total_volume
        FROM slice
        GROUP BY token_address
        ORDER BY total_volume DESC
        LIMIT 10
      `,
    };

    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
    });

    // Verify export succeeded
    expect(result.manifest).toBeDefined();
    expect(result.manifest.parquetFiles.length).toBeGreaterThan(0);

    // Verify analysis succeeded
    if (result.analysis.status !== 'ok') {
      const errorMsg = `Analysis failed with status '${result.analysis.status}'. Warnings: ${JSON.stringify(result.analysis.warnings || [])}`;
      throw new Error(errorMsg);
    }
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();

    // Complex query returns multiple rows, so summary should have row count
    const summary = result.analysis.summary!;
    expect(summary.rows).toBeDefined();
    expect(typeof summary.rows).toBe('number');
    expect(summary.rows as number).toBeGreaterThanOrEqual(0);
    expect(summary.columns).toBeDefined();
    expect(Array.isArray(summary.columns)).toBe(true);
  }, 120000);

  it('E2E: should handle empty result set with analysis', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('e2e-empty'),
      createdAtIso: new Date().toISOString(),
    };

    // Use a time range that likely has no data (far future)
    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
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

    // Should handle empty result gracefully
    expect(result.manifest).toBeDefined();
    // Empty result may still create a manifest with 0 files or may create an empty Parquet file
    // Both are acceptable behaviors

    // Analysis should still work (even with empty data)
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();

    // Empty result should have 0 rows
    const summary = result.analysis.summary!;
    if (summary.total_rows !== undefined) {
      expect(summary.total_rows as number).toBe(0);
    }
  }, 120000);

  it('E2E: should enforce limits correctly', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('e2e-limits'),
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

    // Test with very restrictive maxFiles limit (should pass if export produces 1 file)
    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
      limits: {
        maxFiles: 1, // Should pass for single-file export
      },
    });

    expect(result.manifest).toBeDefined();
    expect(result.manifest.parquetFiles.length).toBeLessThanOrEqual(1);
  }, 120000);

  it('E2E: should handle empty result sets with improved diagnostics', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('e2e-empty-diagnostics'),
      createdAtIso: new Date().toISOString(),
    };

    // Use a time range that likely has no data (far future)
    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
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

    // Should handle empty result gracefully
    expect(result.manifest).toBeDefined();
    expect(result.manifest.summary.totalRows).toBe(0);

    // Check that manifest includes diagnostic information if available
    const summary = result.manifest.summary as any;
    if (summary._diagnostics) {
      expect(summary._diagnostics).toHaveProperty('hasDataInTable');
      expect(summary._diagnostics).toHaveProperty('hasDataInTimeRange');
      expect(summary._diagnostics).toHaveProperty('message');
    }

    // Analysis should still work (even with empty data)
    expect(result.analysis.status).toBe('ok');
    expect(result.analysis.summary).toBeDefined();

    // Empty result should have 0 rows
    const analysisSummary = result.analysis.summary!;
    if (analysisSummary.total_rows !== undefined) {
      expect(analysisSummary.total_rows as number).toBe(0);
    }
  }, 120000);

  it('E2E: should handle DuckDB analysis errors gracefully', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('e2e-analysis-error'),
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

    // Invalid SQL query that should fail - use a query that will definitely cause an error
    // Use a syntax error that DuckDB will definitely catch (missing FROM clause)
    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT * WHERE invalid_column_xyz = 123', // Missing FROM clause - guaranteed syntax error
    };

    const result = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis,
      exporter,
      analyzer,
    });

    // Export should succeed
    expect(result.manifest).toBeDefined();
    expect(result.manifest.parquetFiles.length).toBeGreaterThan(0);

    // Analysis should fail gracefully with error message
    expect(result.analysis.status).toBe('failed');
    expect(result.analysis.warnings).toBeDefined();
    expect(result.analysis.warnings!.length).toBeGreaterThan(0);
    // Check for error-related text (case-insensitive)
    const firstWarning = result.analysis.warnings![0].toLowerCase();
    expect(firstWarning).toMatch(/error|binder|failed/);
  }, 120000);

  it('E2E: should handle missing Parquet files gracefully', async () => {
    const exporter = createClickHouseSliceExporterAdapterImpl();
    const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

    const run: RunContext = {
      runId: generateTestRunId('e2e-missing-files'),
      createdAtIso: new Date().toISOString(),
    };

    // First, export to create manifest
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

    const exportResult = await exportAndAnalyzeSlice({
      run,
      spec,
      layout,
      analysis: { kind: 'sql', sql: 'SELECT 1' },
      exporter,
      analyzer,
    });

    // Delete Parquet files to simulate missing files
    for (const file of exportResult.manifest.parquetFiles) {
      const filePath = file.path.replace(/^file:\/\//, '');
      try {
        await fs.unlink(filePath);
      } catch {
        // Ignore if file doesn't exist
      }
    }

    // Try to analyze with missing files
    const analysis: AnalysisSpec = {
      kind: 'sql',
      sql: 'SELECT COUNT(*) as total_rows FROM slice',
    };

    const analyzeResult = await analyzer.analyze({
      run,
      manifest: exportResult.manifest,
      analysis,
    });

    // Should handle missing files gracefully
    expect(analyzeResult.status).toBe('failed');
    expect(analyzeResult.warnings).toBeDefined();
    expect(analyzeResult.warnings!.length).toBeGreaterThan(0);
    expect(analyzeResult.warnings![0]).toContain('Missing files');
  }, 120000);
});
