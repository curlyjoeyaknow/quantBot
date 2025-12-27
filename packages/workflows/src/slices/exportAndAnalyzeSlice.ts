import type {
  ExportAndAnalyzeResult,
  ParquetLayoutSpec,
  RunContext,
  SliceSpec,
  SliceAnalysisSpec,
  SliceAnalyzer,
  SliceExporter,
} from '@quantbot/core';
import { ValidationError, AppError } from '@quantbot/utils';

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
  if (!run?.runId) {
    throw new ValidationError('run.runId is required', { field: 'run.runId' });
  }
  if (!run?.createdAtIso) {
    throw new ValidationError('run.createdAtIso is required', { field: 'run.createdAtIso' });
  }
  if (!spec?.dataset) {
    throw new ValidationError('spec.dataset is required', { field: 'spec.dataset' });
  }
  if (!spec?.timeRange?.startIso || !spec?.timeRange?.endIso) {
    throw new ValidationError('spec.timeRange.startIso and endIso are required', {
      field: 'spec.timeRange',
      startIso: spec?.timeRange?.startIso,
      endIso: spec?.timeRange?.endIso,
    });
  }
  if (!layout?.baseUri || !layout?.subdirTemplate) {
    throw new ValidationError('layout.baseUri and layout.subdirTemplate are required', {
      field: 'layout',
      baseUri: layout?.baseUri,
      subdirTemplate: layout?.subdirTemplate,
    });
  }

  // Input validation: time range
  const startDate = new Date(spec.timeRange.startIso);
  const endDate = new Date(spec.timeRange.endIso);
  if (isNaN(startDate.getTime())) {
    throw new ValidationError('spec.timeRange.startIso is not a valid ISO date', {
      field: 'spec.timeRange.startIso',
      value: spec.timeRange.startIso,
    });
  }
  if (isNaN(endDate.getTime())) {
    throw new ValidationError('spec.timeRange.endIso is not a valid ISO date', {
      field: 'spec.timeRange.endIso',
      value: spec.timeRange.endIso,
    });
  }
  if (startDate >= endDate) {
    throw new ValidationError('spec.timeRange.startIso must be before endIso', {
      field: 'spec.timeRange',
      startIso: spec.timeRange.startIso,
      endIso: spec.timeRange.endIso,
    });
  }

  // Input validation: max 90 days (configurable limit)
  const maxDays = 90;
  const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > maxDays) {
    throw new ValidationError(`Time range exceeds maximum of ${maxDays} days`, {
      field: 'spec.timeRange',
      maxDays,
      actualDays: Math.ceil(daysDiff),
      startIso: spec.timeRange.startIso,
      endIso: spec.timeRange.endIso,
    });
  }

  // Input validation: token addresses format (32-44 chars, no invalid chars)
  if (spec.tokenIds) {
    for (const tokenId of spec.tokenIds) {
      if (typeof tokenId !== 'string') {
        throw new ValidationError('tokenIds must be strings', {
          field: 'spec.tokenIds',
          invalidType: typeof tokenId,
          value: tokenId,
        });
      }
      if (tokenId.length < 32 || tokenId.length > 44) {
        throw new ValidationError('tokenId must be 32-44 characters', {
          field: 'spec.tokenIds',
          tokenId: tokenId.substring(0, 20) + '...',
          length: tokenId.length,
          minLength: 32,
          maxLength: 44,
        });
      }
      // Basic validation: alphanumeric and base58-like characters
      if (!/^[A-Za-z0-9]+$/.test(tokenId)) {
        throw new ValidationError('tokenId contains invalid characters', {
          field: 'spec.tokenIds',
          tokenId: tokenId.substring(0, 20) + '...',
        });
      }
    }
  }

  const manifest = await exporter.exportSlice({ run, spec, layout });

  if (limits?.maxFiles !== undefined && manifest.parquetFiles.length > limits.maxFiles) {
    throw new AppError('Export produced too many files', 'EXPORT_FILE_LIMIT_EXCEEDED', 400, {
      fileCount: manifest.parquetFiles.length,
      maxFiles: limits.maxFiles,
    });
  }

  const analysisResult = await analyzer.analyze({ run, manifest, analysis });

  return { manifest, analysis: analysisResult };
}
