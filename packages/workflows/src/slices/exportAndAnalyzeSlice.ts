import type {
  ExportAndAnalyzeResult,
  ParquetLayoutSpec,
  RunContext,
  SliceSpec,
  SliceAnalysisSpec,
  SliceAnalyzer,
  SliceExporter,
} from '@quantbot/core';

/**
 * Pure workflow handler:
 * - orchestrates export -> analyze
 * - never touches fs, env, db clients
 * - deterministic given inputs + deterministic adapters
 */
export async function exportAndAnalyzeSlice(args: {
  run: RunContext;
  spec: SliceSpec;
  layout: ParquetLayoutSpec;
  analysis: SliceAnalysisSpec;

  exporter: SliceExporter;
  analyzer: SliceAnalyzer;

  /**
   * Optional safety limits for defense-in-depth.
   */
  limits?: {
    maxFiles?: number;
  };
}): Promise<ExportAndAnalyzeResult> {
  const { run, spec, layout, analysis, exporter, analyzer, limits } = args;

  // Basic validation (pure)
  if (!run?.runId) throw new Error('exportAndAnalyzeSlice: run.runId is required');
  if (!run?.createdAtIso) throw new Error('exportAndAnalyzeSlice: run.createdAtIso is required');
  if (!spec?.dataset) throw new Error('exportAndAnalyzeSlice: spec.dataset is required');
  if (!spec?.timeRange?.startIso || !spec?.timeRange?.endIso) {
    throw new Error('exportAndAnalyzeSlice: spec.timeRange.startIso/endIso are required');
  }
  if (!layout?.baseUri || !layout?.subdirTemplate) {
    throw new Error('exportAndAnalyzeSlice: layout.baseUri and layout.subdirTemplate are required');
  }

  // Input validation: time range
  const startDate = new Date(spec.timeRange.startIso);
  const endDate = new Date(spec.timeRange.endIso);
  if (isNaN(startDate.getTime())) {
    throw new Error(
      `exportAndAnalyzeSlice: spec.timeRange.startIso is not a valid ISO date: ${spec.timeRange.startIso}`
    );
  }
  if (isNaN(endDate.getTime())) {
    throw new Error(
      `exportAndAnalyzeSlice: spec.timeRange.endIso is not a valid ISO date: ${spec.timeRange.endIso}`
    );
  }
  if (startDate >= endDate) {
    throw new Error(
      `exportAndAnalyzeSlice: spec.timeRange.startIso (${spec.timeRange.startIso}) must be before endIso (${spec.timeRange.endIso})`
    );
  }

  // Input validation: max 90 days (configurable limit)
  const maxDays = 90;
  const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > maxDays) {
    throw new Error(
      `exportAndAnalyzeSlice: time range exceeds maximum of ${maxDays} days (got ${Math.ceil(daysDiff)} days)`
    );
  }

  // Input validation: token addresses format (32-44 chars, no invalid chars)
  if (spec.tokenIds) {
    for (const tokenId of spec.tokenIds) {
      if (typeof tokenId !== 'string') {
        throw new Error(`exportAndAnalyzeSlice: tokenIds must be strings, got ${typeof tokenId}`);
      }
      if (tokenId.length < 32 || tokenId.length > 44) {
        throw new Error(
          `exportAndAnalyzeSlice: tokenId must be 32-44 characters, got ${tokenId.length}: ${tokenId.substring(0, 20)}...`
        );
      }
      // Basic validation: alphanumeric and base58-like characters
      if (!/^[A-Za-z0-9]+$/.test(tokenId)) {
        throw new Error(
          `exportAndAnalyzeSlice: tokenId contains invalid characters: ${tokenId.substring(0, 20)}...`
        );
      }
    }
  }

  const manifest = await exporter.exportSlice({ run, spec, layout });

  if (limits?.maxFiles !== undefined && manifest.parquetFiles.length > limits.maxFiles) {
    throw new Error(
      `exportAndAnalyzeSlice: export produced ${manifest.parquetFiles.length} files (limit ${limits.maxFiles})`
    );
  }

  const analysisResult = await analyzer.analyze({ run, manifest, analysis });

  return { manifest, analysis: analysisResult };
}
