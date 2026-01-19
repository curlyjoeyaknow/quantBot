/**
 * FeatureSetCompiler
 *
 * Compiles feature specifications from presets into computed features.
 *
 * Input: SimPreset.features (YAML)
 * Output: feature_set_id, features.parquet, features.manifest.json
 */

import { createHash } from 'crypto';
import { DuckDBClient } from '@quantbot/storage';
import { logger } from '@quantbot/infra/utils';
import { submitArtifact } from '@quantbot/infra/utils';
import type { FeaturesSpec } from './types.js';
import { FeaturesSpecSchema } from './types.js';
import { getIndicatorRegistry } from './IndicatorRegistry.js';
import type { FeatureManifest } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface CompileFeaturesOptions {
  /**
   * Path to input candle Parquet file (from slice export)
   */
  sliceParquetPath: string;

  /**
   * Features specification from preset
   */
  featuresSpec: FeaturesSpec;

  /**
   * Output directory for features.parquet and manifest
   */
  outputDir: string;

  /**
   * Run context for manifest
   */
  runId: string;
  createdAtIso: string;
}

export interface CompileFeaturesResult {
  featureSetId: string;
  featuresParquetPath: string;
  manifestPath: string;
  manifest: FeatureManifest;
  rowCount: number;
  byteSize: number;
}

/**
 * FeatureSetCompiler
 */
export class FeatureSetCompiler {
  /**
   * Compute feature_set_id from features spec (deterministic hash)
   */
  static computeFeatureSetId(spec: FeaturesSpec): string {
    const specStr = JSON.stringify(spec, Object.keys(spec).sort());
    return createHash('sha256').update(specStr).digest('hex').slice(0, 16);
  }

  /**
   * Compile features from specification
   */
  async compileFeatures(options: CompileFeaturesOptions): Promise<CompileFeaturesResult> {
    const { sliceParquetPath, featuresSpec, outputDir, runId, createdAtIso } = options;

    // Validate features spec
    const validated = FeaturesSpecSchema.parse(featuresSpec);

    // Compute feature_set_id
    const featureSetId = FeatureSetCompiler.computeFeatureSetId(validated);

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const registry = getIndicatorRegistry();

    // Build feature columns
    const featureColumns: string[] = [];
    const indicators: FeatureManifest['indicators'] = [];

    for (const group of validated.groups) {
      for (const indicatorConfig of group.indicators) {
        const indicator = registry.get(indicatorConfig.type);
        if (!indicator) {
          throw new Error(`Unknown indicator type: ${indicatorConfig.type}`);
        }

        // Extract params
        const params: Record<string, number> = {};
        if (indicatorConfig.period !== undefined) params.period = indicatorConfig.period;
        if (indicatorConfig.fastPeriod !== undefined)
          params.fastPeriod = indicatorConfig.fastPeriod;
        if (indicatorConfig.slowPeriod !== undefined)
          params.slowPeriod = indicatorConfig.slowPeriod;
        if (indicatorConfig.signalPeriod !== undefined)
          params.signalPeriod = indicatorConfig.signalPeriod;
        if (indicatorConfig.stdDev !== undefined) params.stdDev = indicatorConfig.stdDev;

        // Generate feature name and SQL
        const featureName = indicator.generateName(params);
        const featureSQL = indicator.generateSQL('close', 'high', 'low', 'volume', params);

        featureColumns.push(`${featureSQL} AS ${featureName}`);
        indicators.push({
          name: featureName,
          type: indicatorConfig.type,
          params,
        });
      }
    }

    if (featureColumns.length === 0) {
      throw new Error('No features to compute');
    }

    // Compute features using DuckDB
    const db = new DuckDBClient(':memory:');
    try {
      // Install and load parquet extension
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      // Read candle slice
      await db.execute(`
        CREATE OR REPLACE VIEW candles AS 
        SELECT * FROM read_parquet('${sliceParquetPath.replace(/'/g, "''")}')
      `);

      // Compute features
      const featuresQuery = `
        SELECT 
          chain,
          token_id,
          ts,
          interval,
          open,
          high,
          low,
          close,
          volume,
          ${featureColumns.join(',\n          ')}
        FROM candles
        ORDER BY token_id, ts
      `;

      // Write features to Parquet
      const featuresParquetPath = join(outputDir, 'features.parquet');
      await db.execute(`
        COPY (${featuresQuery}) TO '${featuresParquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)
      `);

      // Get row count and file size
      const countResult = await db.query(`
        SELECT COUNT(*) as cnt FROM (${featuresQuery})
      `);
      const rowCount = countResult.rows[0]?.[0] ? Number(countResult.rows[0][0]) : 0;

      const stats = await fs.stat(featuresParquetPath);
      const byteSize = stats.size;

      // Compute schema hash
      const schemaResult = await db.query(`
        DESCRIBE SELECT * FROM (${featuresQuery}) LIMIT 1
      `);
      const schemaStr = JSON.stringify(
        schemaResult.rows.map((row: unknown[]) => ({ name: row[0], type: row[1] }))
      );
      const schemaHash = createHash('sha256').update(schemaStr).digest('hex').slice(0, 16);

      // Create manifest
      const manifest: FeatureManifest = {
        version: 1,
        featureSetId,
        createdAtIso,
        spec: validated,
        schemaHash,
        parquetPath: featuresParquetPath,
        rowCount,
        byteSize,
        indicators,
      };

      // Write manifest
      const manifestPath = join(outputDir, 'features.manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      logger.info('Feature compilation completed', {
        featureSetId,
        indicators: indicators.length,
        rowCount,
        byteSize,
      });

      // Submit to bus (Phase 2: Bus migration)
      try {
        await submitArtifact({
          runId,
          producer: 'features',
          kind: 'features',
          artifactId: `features_${featureSetId}`,
          parquetPath: featuresParquetPath,
          schemaHint: 'features.computed',
          rows: rowCount,
          meta: {
            featureSetId,
            indicators: indicators.length,
            byteSize,
            schemaHash,
          },
        });
        logger.info('Features submitted to bus', { runId, featureSetId });
      } catch (error) {
        // Don't fail if bus submission fails - features are still written locally
        logger.warn('Failed to submit features to bus (features still written locally)', {
          runId,
          featureSetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        featureSetId,
        featuresParquetPath,
        manifestPath,
        manifest,
        rowCount,
        byteSize,
      };
    } finally {
      await db.close();
    }
  }
}
