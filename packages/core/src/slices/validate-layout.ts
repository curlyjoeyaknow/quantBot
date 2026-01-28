/**
 * Parquet Layout Validation
 *
 * Enforces canonical artifact spec for consistent Parquet exports.
 * Validates partitioning, file sizing, and naming conventions.
 */

import { ValidationError } from '../errors.js';
import type { ParquetLayoutSpec } from './types.js';

/**
 * Required partition keys for canonical layout
 */
const REQUIRED_PARTITION_KEYS: Array<'dt' | 'chain' | 'dataset' | 'runId'> = [
  'dt',
  'chain',
  'dataset',
];

/**
 * Recommended file size range (bytes)
 */
const MIN_FILE_SIZE_BYTES = 128 * 1024 * 1024; // 128MB
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

/**
 * Validate ParquetLayoutSpec against canonical artifact spec
 *
 * @throws ValidationError if layout doesn't conform to spec
 */
export function validateParquetLayout(layout: ParquetLayoutSpec): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate subdirTemplate contains required partition keys
  const template = layout.subdirTemplate;
  if (!template) {
    errors.push('subdirTemplate is required');
    return { valid: false, errors, warnings };
  }

  // Check for required partition keys in template
  for (const key of REQUIRED_PARTITION_KEYS) {
    const placeholder = `{${key}}`;
    // Special case for 'dt': accept either {dt} or dt={yyyy}-{mm}-{dd} format
    if (key === 'dt') {
      if (!template.includes(placeholder) && !template.includes('dt={yyyy}-{mm}-{dd}')) {
        errors.push(
          `subdirTemplate must include partition key '${key}' as placeholder '{${key}}' or use 'dt={yyyy}-{mm}-{dd}' format`
        );
      }
    } else {
      if (!template.includes(placeholder)) {
        errors.push(`subdirTemplate must include partition key '${key}' as placeholder '{${key}}'`);
      }
    }
  }

  // Check for date partition format (dt={yyyy}-{mm}-{dd})
  if (!template.includes('dt={yyyy}-{mm}-{dd}') && !template.includes('dt={dt}')) {
    warnings.push(
      "Recommended: Use 'dt={yyyy}-{mm}-{dd}' format for date partitioning (e.g., 'dt=2024-01-15')"
    );
  }

  // 2. Validate partitionKeys array matches template
  if (layout.partitionKeys) {
    const templateKeys = new Set<string>();
    const templateMatches = template.matchAll(/\{(\w+)\}/g);
    for (const match of templateMatches) {
      templateKeys.add(match[1]);
    }

    for (const key of layout.partitionKeys) {
      if (!templateKeys.has(key)) {
        warnings.push(
          `partitionKeys includes '${key}' but template doesn't use '{${key}}' placeholder`
        );
      }
    }

    // Check that required keys are in partitionKeys
    for (const requiredKey of REQUIRED_PARTITION_KEYS) {
      if (!layout.partitionKeys.includes(requiredKey)) {
        warnings.push(
          `Recommended: Include '${requiredKey}' in partitionKeys array for canonical layout`
        );
      }
    }
  } else {
    warnings.push('partitionKeys not specified - recommended for canonical layout');
  }

  // 3. Validate file sizing
  if (layout.maxRowsPerFile) {
    // Rough estimate: assume ~100 bytes per row (varies by schema)
    const estimatedBytes = layout.maxRowsPerFile * 100;
    if (estimatedBytes < MIN_FILE_SIZE_BYTES) {
      warnings.push(
        `maxRowsPerFile (${layout.maxRowsPerFile}) may produce files smaller than recommended minimum (128MB). Consider increasing.`
      );
    }
    if (estimatedBytes > MAX_FILE_SIZE_BYTES) {
      warnings.push(
        `maxRowsPerFile (${layout.maxRowsPerFile}) may produce files larger than recommended maximum (1GB). Consider decreasing.`
      );
    }
  } else {
    warnings.push(
      'maxRowsPerFile not specified - recommended to control file size (aim for 128MB-1GB per file)'
    );
  }

  // 4. Validate compression
  if (!layout.compression) {
    warnings.push('compression not specified - recommended: "snappy" or "zstd"');
  } else if (!['snappy', 'zstd', 'gzip', 'none'].includes(layout.compression)) {
    errors.push(
      `Invalid compression: ${layout.compression}. Must be one of: snappy, zstd, gzip, none`
    );
  }

  // 5. Validate baseUri format
  if (layout.baseUri) {
    if (!layout.baseUri.startsWith('file://') && !layout.baseUri.startsWith('s3://')) {
      warnings.push(
        "baseUri should start with 'file://' (local) or 's3://' (S3) for canonical layout"
      );
    }
  } else {
    errors.push('baseUri is required');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get canonical layout spec (reference implementation)
 */
export function getCanonicalLayoutSpec(baseUri: string): ParquetLayoutSpec {
  return {
    baseUri,
    subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    compression: 'snappy',
    maxRowsPerFile: 1_000_000, // ~100MB assuming 100 bytes/row
    partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
  };
}

/**
 * Assert layout is valid (throws on error)
 */
export function assertValidParquetLayout(layout: ParquetLayoutSpec): void {
  const validation = validateParquetLayout(layout);
  if (!validation.valid) {
    throw new ValidationError('Invalid ParquetLayoutSpec', {
      errors: validation.errors,
      warnings: validation.warnings,
      layout,
    });
  }
  if (validation.warnings.length > 0) {
    // Log warnings but don't fail
    console.warn('ParquetLayoutSpec warnings:', validation.warnings);
  }
}
