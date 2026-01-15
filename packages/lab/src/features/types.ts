/**
 * Feature computation types
 */

import { z } from 'zod';

/**
 * Indicator type definitions
 */
export type IndicatorType = 'sma' | 'ema' | 'rsi' | 'atr' | 'macd' | 'bollinger';

/**
 * Indicator configuration from preset YAML
 */
export const IndicatorConfigSchema = z.object({
  type: z.enum(['sma', 'ema', 'rsi', 'atr', 'macd', 'bollinger']),
  period: z.number().int().positive().optional(),
  fastPeriod: z.number().int().positive().optional(),
  slowPeriod: z.number().int().positive().optional(),
  signalPeriod: z.number().int().positive().optional(),
  stdDev: z.number().positive().optional(),
});

export type IndicatorConfig = z.infer<typeof IndicatorConfigSchema>;

/**
 * Feature group from preset
 */
export const FeatureGroupSchema = z.object({
  name: z.string(),
  indicators: z.array(IndicatorConfigSchema),
});

export type FeatureGroup = z.infer<typeof FeatureGroupSchema>;

/**
 * Features specification from preset
 */
export const FeaturesSpecSchema = z.object({
  timeframe: z.enum(['1m', '5m', '1h', '1d']),
  groups: z.array(FeatureGroupSchema),
});

export type FeaturesSpec = z.infer<typeof FeaturesSpecSchema>;

/**
 * Feature manifest with versioning
 */
export interface FeatureManifest {
  version: 1;
  featureSetId: string;
  createdAtIso: string;
  spec: FeaturesSpec;
  schemaHash: string;
  parquetPath: string;
  rowCount?: number;
  byteSize?: number;
  indicators: Array<{
    name: string;
    type: IndicatorType;
    params: Record<string, number>;
  }>;
  // Versioning fields
  featureSetVersion?: string; // Version of the feature set
  featureSpecVersion?: string; // DSL version of the feature spec
  computedAtIso?: string; // When features were computed
  computedBy?: string; // Git commit hash that computed these features
}

/**
 * Indicator registry entry
 */
export interface IndicatorDefinition {
  type: IndicatorType;
  name: string;
  /**
   * Generate DuckDB SQL expression for this indicator
   * @param closeColumn - Column name for close price (usually 'close')
   * @param highColumn - Column name for high price (usually 'high')
   * @param lowColumn - Column name for low price (usually 'low')
   * @param volumeColumn - Column name for volume (usually 'volume')
   * @param params - Indicator parameters from config
   * @returns SQL expression that computes the indicator value
   */
  generateSQL: (
    closeColumn: string,
    highColumn: string,
    lowColumn: string,
    volumeColumn: string,
    params: Record<string, number>
  ) => string;
  /**
   * Generate feature column name
   * @param params - Indicator parameters
   * @returns Namespaced feature name (e.g., 'ema_9', 'rsi_14')
   */
  generateName: (params: Record<string, number>) => string;
}
