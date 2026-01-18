/**
 * Slice Schema Validator
 *
 * Validates exported candle Parquet files meet Phase 1.1 requirements:
 * - Fixed schema: (chain, token_id, ts, interval, open, high, low, close, volume)
 * - ts aligned to interval bucket (no fractional minutes)
 * - Monotonic per token (validate ordering)
 * - Gap detection (flag, don't fix)
 */

import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger } from '@quantbot/infra/utils';

export interface SliceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  schemaHash?: string;
  gaps?: Array<{
    tokenId: string;
    gapStart: number;
    gapEnd: number;
    expectedInterval: string;
  }>;
}

export interface SliceValidationOptions {
  /**
   * If true, validate ts alignment to interval bucket
   * @default true
   */
  validateTsAlignment?: boolean;

  /**
   * If true, validate monotonic ordering per token
   * @default true
   */
  validateMonotonic?: boolean;

  /**
   * If true, detect and report gaps (but don't fail validation)
   * @default true
   */
  detectGaps?: boolean;

  /**
   * Expected interval for ts alignment validation
   * @default '1m'
   */
  expectedInterval?: string;
}

/**
 * Validate Parquet file schema and data quality
 */
export async function validateSliceParquet(
  parquetPath: string,
  options: SliceValidationOptions = {}
): Promise<SliceValidationResult> {
  const {
    validateTsAlignment = true,
    validateMonotonic = true,
    detectGaps = true,
    expectedInterval = '1m',
  } = options;

  const errors: string[] = [];
  const warnings: string[] = [];
  const gaps: SliceValidationResult['gaps'] = [];

  const db = new DuckDBClient(':memory:');
  try {
    // Install and load parquet extension
    await db.execute('INSTALL parquet;');
    await db.execute('LOAD parquet;');

    // Read parquet file
    await db.execute(`
      CREATE OR REPLACE VIEW slice_data AS 
      SELECT * FROM read_parquet('${parquetPath.replace(/'/g, "''")}')
    `);

    // Validate schema exists
    const schemaResult = await db.query(`
      DESCRIBE SELECT * FROM slice_data
    `);

    const columns = schemaResult.rows.map((row) => row[0] as string);
    const expectedColumns = [
      'chain',
      'token_id',
      'ts',
      'interval',
      'open',
      'high',
      'low',
      'close',
      'volume',
    ];

    // Check for required columns
    for (const col of expectedColumns) {
      if (!columns.includes(col)) {
        errors.push(`Missing required column: ${col}`);
      }
    }

    // Check for unexpected columns (warn only)
    for (const col of columns) {
      if (!expectedColumns.includes(col)) {
        warnings.push(`Unexpected column: ${col}`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, warnings, gaps };
    }

    // Validate ts alignment to interval bucket
    if (validateTsAlignment) {
      const intervalSeconds = parseIntervalToSeconds(expectedInterval);
      if (intervalSeconds > 0) {
        const alignmentResult = await db.query(`
          SELECT 
            token_id,
            ts,
            ts % ${intervalSeconds} as remainder
          FROM slice_data
          WHERE ts % ${intervalSeconds} != 0
          LIMIT 10
        `);

        if (alignmentResult.rows.length > 0) {
          errors.push(
            `Found ${alignmentResult.rows.length} timestamps not aligned to ${expectedInterval} interval bucket`
          );
          // Log first few examples
          for (const row of alignmentResult.rows.slice(0, 5)) {
            errors.push(`  Example: token_id=${row[0]}, ts=${row[1]}, remainder=${row[2]}`);
          }
        }
      }
    }

    // Validate monotonic ordering per token
    if (validateMonotonic) {
      const monotonicResult = await db.query(`
        WITH ordered AS (
          SELECT 
            token_id,
            ts,
            LAG(ts) OVER (PARTITION BY token_id ORDER BY ts) as prev_ts
          FROM slice_data
        )
        SELECT 
          token_id,
          ts,
          prev_ts
        FROM ordered
        WHERE prev_ts IS NOT NULL AND ts <= prev_ts
        LIMIT 10
      `);

      if (monotonicResult.rows.length > 0) {
        errors.push(
          `Found ${monotonicResult.rows.length} non-monotonic timestamps (ts <= previous ts for same token)`
        );
        // Log first few examples
        for (const row of monotonicResult.rows.slice(0, 5)) {
          errors.push(`  Example: token_id=${row[0]}, ts=${row[1]}, prev_ts=${row[2]}`);
        }
      }
    }

    // Detect gaps (warn only, don't fail)
    if (detectGaps && expectedInterval) {
      const intervalSeconds = parseIntervalToSeconds(expectedInterval);
      if (intervalSeconds > 0) {
        const gapResult = await db.query(`
          WITH ordered AS (
            SELECT 
              token_id,
              ts,
              LAG(ts) OVER (PARTITION BY token_id ORDER BY ts) as prev_ts
            FROM slice_data
          ),
          gaps AS (
            SELECT 
              token_id,
              prev_ts as gap_start,
              ts as gap_end,
              (ts - prev_ts) / ${intervalSeconds} - 1 as missing_intervals
            FROM ordered
            WHERE prev_ts IS NOT NULL 
              AND (ts - prev_ts) > ${intervalSeconds}
          )
          SELECT * FROM gaps
          LIMIT 100
        `);

        for (const row of gapResult.rows) {
          gaps.push({
            tokenId: row[0] as string,
            gapStart: row[1] as number,
            gapEnd: row[2] as number,
            expectedInterval: expectedInterval,
          });
        }

        if (gaps.length > 0) {
          warnings.push(
            `Detected ${gaps.length} gaps in time series (gaps are flagged, not fixed)`
          );
        }
      }
    }

    // Compute schema hash
    const schemaHash = await computeSchemaHash(db, parquetPath);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      gaps: gaps.length > 0 ? gaps : undefined,
      schemaHash,
    };
  } catch (error) {
    logger.error('Failed to validate slice Parquet', error as Error, { parquetPath });
    return {
      valid: false,
      errors: [`Validation failed: ${error instanceof Error ? error.message : String(error)}`],
      warnings,
      gaps,
    };
  } finally {
    await db.close();
  }
}

/**
 * Parse interval string to seconds
 */
function parseIntervalToSeconds(interval: string): number {
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return 0;
  }
}

/**
 * Compute deterministic schema hash for manifest
 */
async function computeSchemaHash(db: DuckDBClient, parquetPath: string): Promise<string> {
  try {
    // Get schema info
    const schemaResult = await db.query(`
      DESCRIBE SELECT * FROM slice_data
    `);

    // Create deterministic hash from column names and types
    const schemaStr = JSON.stringify(
      schemaResult.rows.map((row) => ({ name: row[0], type: row[1] }))
    );

    // Use crypto for deterministic hash
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(schemaStr).digest('hex').slice(0, 16);
  } catch (error) {
    logger.warn('Failed to compute schema hash', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unknown';
  }
}
