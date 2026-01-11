/**
 * RandomSearch
 *
 * Random search over parameter space.
 * Samples configs randomly instead of exhaustive search.
 */

import type { ParameterSpaceDef, ParameterConfig, OptimizationConfig } from './types.js';
import { ParameterSpace } from './ParameterSpace.js';
import { logger } from '@quantbot/utils';
import type { OptimizationResult } from './GridSearch.js';

/**
 * RandomSearch optimizer
 */
export class RandomSearch {
  private readonly paramSpace: ParameterSpace;

  constructor() {
    this.paramSpace = new ParameterSpace();
  }

  /**
   * Run random search
   */
  async search(
    space: ParameterSpaceDef,
    evaluateFn: (config: ParameterConfig) => Promise<unknown>,
    config: OptimizationConfig = { strategy: 'random_search', maxConfigs: 100 }
  ): Promise<OptimizationResult[]> {
    // Validate space
    const validation = this.paramSpace.validate(space);
    if (!validation.valid) {
      throw new Error(`Invalid parameter space: ${validation.errors.join('; ')}`);
    }

    // Generate random sample
    const maxConfigs = config.maxConfigs ?? 100;
    const configs = this.paramSpace.generateRandomConfigs(space, maxConfigs);

    logger.info('Starting random search', {
      totalConfigs: configs.length,
      maxConfigs,
      spaceSize: this.paramSpace.estimateConfigCount(space),
    });

    // Evaluate each config
    const results: OptimizationResult[] = [];
    for (let i = 0; i < configs.length; i++) {
      const paramConfig = configs[i]!;

      try {
        const metrics = await evaluateFn(paramConfig);
        const score = this.computeScore(metrics);

        results.push({
          config: paramConfig,
          metrics,
          score,
        });

        logger.debug('Random search progress', {
          config: i + 1,
          total: configs.length,
          score,
        });

        // Early stopping check
        if (config.earlyStopping?.enabled && this.shouldStopEarly(results, config.earlyStopping)) {
          logger.info('Early stopping triggered', {
            configsEvaluated: i + 1,
            totalConfigs: configs.length,
          });
          break;
        }
      } catch (error) {
        logger.warn('Failed to evaluate config', {
          error: error instanceof Error ? error.message : String(error),
          config: paramConfig,
        });
        // Continue with next config
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    logger.info('Random search completed', {
      totalConfigs: configs.length,
      evaluated: results.length,
      bestScore: results[0]?.score,
    });

    return results;
  }

  /**
   * Compute score from metrics (same as GridSearch)
   */
  private computeScore(metrics: unknown): number {
    if (!metrics || typeof metrics !== 'object') {
      return 0;
    }

    const m = metrics as Record<string, unknown>;

    // Combine PnL and Sharpe ratio
    const pnl = typeof m.totalPnlPercent === 'number' ? m.totalPnlPercent : 0;
    const sharpe = typeof m.sharpeRatio === 'number' ? m.sharpeRatio : 0;
    const winRate = typeof m.winRate === 'number' ? m.winRate : 0;

    // Weighted score
    return pnl * 0.5 + sharpe * 30 + winRate * 20;
  }

  /**
   * Check if early stopping should trigger
   */
  private shouldStopEarly(
    results: OptimizationResult[],
    earlyStopping: { minConfigs?: number; patience?: number }
  ): boolean {
    if (results.length < (earlyStopping.minConfigs ?? 10)) {
      return false;
    }

    if (!earlyStopping.patience) {
      return false;
    }

    // Check if no improvement in last N results
    if (results.length < earlyStopping.patience) {
      return false;
    }

    const recentResults = results.slice(-earlyStopping.patience);
    const bestRecent = Math.max(...recentResults.map((r) => r.score));
    const bestOverall = Math.max(...results.map((r) => r.score));

    // Stop if recent best is significantly worse than overall best
    return bestRecent < bestOverall * 0.9; // 10% threshold
  }
}
