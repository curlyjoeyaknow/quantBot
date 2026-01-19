/**
 * ParameterSpace
 *
 * Parses optimize: section from presets and generates configs programmatically.
 *
 * Input:
 *   optimize:
 *     ema_fast: [5, 9, 12]
 *     ema_slow: [21, 34, 55]
 *     rsi_thresh: [50, 55, 60]
 *     atr_mult: [1.5, 2.0, 2.5]
 *
 * Output: Array of ParameterConfig (cartesian product or smarter)
 */

import type { ParameterSpaceDef, ParameterConfig } from './types.js';
import { logger } from '@quantbot/infra/utils';

/**
 * ParameterSpace
 */
export class ParameterSpace {
  /**
   * Generate all configs from parameter space (cartesian product)
   */
  generateConfigs(space: ParameterSpaceDef): ParameterConfig[] {
    const paramNames = Object.keys(space);
    const paramValues = paramNames.map((name) => space[name]!);

    if (paramNames.length === 0) {
      return [];
    }

    // Generate cartesian product
    const configs: ParameterConfig[] = [];
    this.cartesianProduct(paramValues, 0, {}, paramNames, configs);

    logger.info('Generated parameter configs', {
      paramCount: paramNames.length,
      totalConfigs: configs.length,
    });

    return configs;
  }

  /**
   * Generate cartesian product recursively
   */
  private cartesianProduct(
    paramValues: Array<Array<number | string>>,
    index: number,
    currentConfig: ParameterConfig,
    paramNames: string[],
    results: ParameterConfig[]
  ): void {
    if (index === paramValues.length) {
      // Base case: all parameters assigned
      results.push({ ...currentConfig });
      return;
    }

    // Recursive case: assign next parameter
    const values = paramValues[index]!;
    const paramName = paramNames[index]!;

    for (const value of values) {
      currentConfig[paramName] = value;
      this.cartesianProduct(paramValues, index + 1, currentConfig, paramNames, results);
    }
  }

  /**
   * Generate random sample of configs (for random search)
   */
  generateRandomConfigs(space: ParameterSpaceDef, count: number, seed?: number): ParameterConfig[] {
    const allConfigs = this.generateConfigs(space);

    if (count >= allConfigs.length) {
      return allConfigs;
    }

    // Use seeded random for determinism
    const rng = this.createSeededRNG(seed ?? 42);
    const shuffled = [...allConfigs].sort(() => rng() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Create seeded RNG (simple LCG)
   */
  private createSeededRNG(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % Math.pow(2, 32);
      return state / Math.pow(2, 32);
    };
  }

  /**
   * Estimate total config count without generating all
   */
  estimateConfigCount(space: ParameterSpaceDef): number {
    return Object.values(space).reduce<number>((product, values) => product * values.length, 1);
  }

  /**
   * Validate parameter space
   */
  validate(space: ParameterSpaceDef): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [paramName, values] of Object.entries(space)) {
      if (!Array.isArray(values)) {
        errors.push(`Parameter ${paramName} must be an array`);
        continue;
      }

      if (values.length === 0) {
        errors.push(`Parameter ${paramName} has no values`);
        continue;
      }

      // Check all values are same type
      const firstType = typeof values[0];
      if (!values.every((v) => typeof v === firstType)) {
        errors.push(`Parameter ${paramName} has mixed types`);
      }
    }

    // Check total config count (warn if too large)
    const totalConfigs = this.estimateConfigCount(space);
    if (totalConfigs > 10000) {
      logger.warn('Parameter space is very large', {
        totalConfigs,
        params: Object.keys(space),
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
