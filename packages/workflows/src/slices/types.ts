/**
 * Pure types for the slice export + analyze workflow.
 * No DB clients, no fs, no env. Just data contracts.
 *
 * NOTE: Types have been moved to @quantbot/core to break circular dependency.
 * Re-export from core for backward compatibility.
 */

import type {
  SliceChain,
  SliceGranularity,
  Compression,
  ParquetPath,
  RunContext,
  SliceSpec,
  ParquetLayoutSpec,
  SliceManifestV1,
  SliceAnalysisSpec,
  SliceAnalysisResult,
  ExportAndAnalyzeResult,
} from '@quantbot/core';

// Re-export all types
export type {
  SliceChain,
  SliceGranularity,
  Compression,
  ParquetPath,
  RunContext,
  SliceSpec,
  ParquetLayoutSpec,
  SliceManifestV1,
  SliceAnalysisSpec,
  SliceAnalysisResult,
  ExportAndAnalyzeResult,
};

// Re-export with original names for backward compatibility
export type AnalysisSpec = SliceAnalysisSpec;
export type AnalysisResult = SliceAnalysisResult;

// Re-export Chain type with original name for backward compatibility
// Note: core uses SliceChain ('sol' | 'eth' | etc) to avoid conflict with core Chain type
export type Chain = SliceChain;
