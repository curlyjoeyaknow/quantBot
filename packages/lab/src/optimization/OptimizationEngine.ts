/**
 * OptimizationEngine
 *
 * Main optimization engine that coordinates search strategies.
 *
 * Supports:
 * - Grid search
 * - Random search
 * - Bayesian (future)
 * - Early stopping on bad configs
 */

import type {
  ParameterSpaceDef,
  ParameterConfig,
  OptimizationConfig,
  OptimizationStrategy,
} from './types.js';
import { GridSearch, type GridSearchResult } from './GridSearch.js';
import { RandomSearch } from './RandomSearch.js';
import { logger } from '@quantbot/infra/utils';

/**
 * OptimizationEngine
 */
export class OptimizationEngine {
  /**
   * Run optimization
   */
  async optimize(
    space: ParameterSpaceDef,
    evaluateFn: (config: ParameterConfig) => Promise<unknown>,
    config: OptimizationConfig
  ): Promise<GridSearchResult[]> {
    const strategy = config.strategy;

    logger.info('Starting optimization', {
      strategy,
      paramCount: Object.keys(space).length,
    });

    switch (strategy) {
      case 'grid_search': {
        const gridSearch = new GridSearch();
        return await gridSearch.search(space, evaluateFn, config);
      }

      case 'random_search': {
        const randomSearch = new RandomSearch();
        return await randomSearch.search(space, evaluateFn, config);
      }

      case 'bayesian':
        // TODO: Implement Bayesian optimization (Optuna-style)
        logger.warn('Bayesian optimization not yet implemented, falling back to random search');
        const fallbackSearch = new RandomSearch();
        return await fallbackSearch.search(space, evaluateFn, {
          ...config,
          strategy: 'random_search',
        });

      default:
        throw new Error(`Unknown optimization strategy: ${strategy}`);
    }
  }

  /**
   * Get best config from results
   */
  getBestConfig(results: GridSearchResult[]): ParameterConfig | undefined {
    if (results.length === 0) {
      return undefined;
    }

    // Results are already sorted by score (descending)
    return results[0]!.config;
  }

  /**
   * Get top N configs
   */
  getTopConfigs(results: GridSearchResult[], n: number): ParameterConfig[] {
    return results.slice(0, n).map((r) => r.config);
  }
}
