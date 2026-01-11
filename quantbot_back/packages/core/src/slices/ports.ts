import type {
  SliceAnalysisResult,
  SliceAnalysisSpec,
  ParquetLayoutSpec,
  RunContext,
  SliceManifestV1,
  SliceSpec,
} from './types.js';

/**
 * Ports (interfaces) used by the pure workflow handler.
 * Implementations live in adapters packages.
 *
 * Moved from @quantbot/workflows to @quantbot/core to break circular dependency
 * between storage and workflows packages.
 */

export interface SliceExporter {
  exportSlice(args: {
    run: RunContext;
    spec: SliceSpec;
    layout: ParquetLayoutSpec;
  }): Promise<SliceManifestV1>;
}

export interface SliceAnalyzer {
  analyze(args: {
    run: RunContext;
    manifest: SliceManifestV1;
    analysis: SliceAnalysisSpec;
  }): Promise<SliceAnalysisResult>;
}

export interface SliceValidator {
  validate(manifest: SliceManifestV1): Promise<{
    ok: boolean;
    errors: string[];
    warnings: string[];
  }>;
}
