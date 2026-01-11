/**
 * SliceAnalyzer Port
 *
 * Port interface for analyzing Parquet slices in DuckDB.
 * Adapters implement this port to handle the actual I/O operations.
 */

import type { SliceManifest } from './slice-exporter-port.js';

/**
 * Analysis query plan
 *
 * Describes what analysis to run on the slice.
 */
export interface AnalysisQueryPlan {
  /** SQL query to execute */
  sql: string;

  /** Output format */
  outputFormat: 'parquet' | 'json' | 'csv' | 'table';

  /** Output path (if format is file-based) */
  outputPath?: string;

  /** Query parameters (for parameterized queries) */
  parameters?: Record<string, unknown>;
}

/**
 * Analysis result metadata
 */
export interface AnalysisResultMetadata {
  /** Number of rows returned */
  rowCount: number;

  /** Columns in result */
  columns: string[];

  /** Execution time in milliseconds */
  executionTimeMs: number;

  /** Output file path (if file-based) */
  outputPath?: string;
}

/**
 * Analysis result
 */
export interface AnalysisResult {
  /** Success flag */
  success: boolean;

  /** Result data (if in-memory format) */
  data?: unknown[];

  /** Result metadata */
  metadata: AnalysisResultMetadata;

  /** Error message if analysis failed */
  error?: string;
}

/**
 * SliceAnalyzer Port
 *
 * Pure interface - no I/O, no filesystem, no network.
 * Adapters implement this to do the actual work.
 *
 * This is one of only two verbs the handler is allowed to touch.
 */
export interface SliceAnalyzerPort {
  /**
   * Analyze a Parquet slice using DuckDB
   *
   * @param manifest - Slice manifest (passed as data, not read from disk)
   * @param analysisSpec - Analysis specification (SQL or query plan)
   * @returns Analysis result
   */
  analyze(manifest: SliceManifest, analysisSpec: AnalysisQueryPlan): Promise<AnalysisResult>;
}
