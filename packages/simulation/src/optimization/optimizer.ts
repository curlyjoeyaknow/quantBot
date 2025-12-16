/**
 * Strategy Optimizer
 *
 * Optimizes trading strategies by testing parameter combinations
 *
 * @deprecated This optimizer is incomplete and violates architectural rules.
 * It should be moved to @quantbot/workflows or accept candles via dependency injection.
 * For now, it's kept for reference but should not be used in production.
 */

import { OptimizationConfig, StrategyOptimizationResult, OptimizationRunResult } from './types';
import { StrategyConfig } from '../strategies/types';
import { generateParameterCombinations } from './grid';
import {
  buildStrategy,
  buildStopLossConfig,
  buildEntryConfig,
  buildReEntryConfig,
  validateStrategy,
} from '../strategies/builder';
import { simulateStrategy } from '../engine';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';
import {
  createProgress,
  logOperationStart,
  logStep,
  logOperationComplete,
  logError,
} from '../utils/progress';

// TODO: loadData should be part of @quantbot/services or removed
// import { loadData } from '../../data/loaders';

export class StrategyOptimizer {
  /**
   * Run optimization with given configuration
   */
  async optimize(config: OptimizationConfig): Promise<OptimizationRunResult> {
    const startTime = Date.now();
    logOperationStart(`Strategy Optimization: ${config.name}`);

    // Generate strategy combinations
    logStep('Generating strategy combinations');
    const strategies = generateParameterCombinations(config.parameterGrid, config.baseStrategy);

    // Limit strategies if specified
    const strategiesToTest = config.maxStrategies
      ? strategies.slice(0, config.maxStrategies)
      : strategies;

    logStep(`Generated ${strategiesToTest.length} strategies to test`, {
      totalGenerated: strategies.length,
      limited: config.maxStrategies ? true : false,
    });

    // Load data
    // TODO: Implement data loading from config or inject as dependency
    const dataRecords: any[] = [];
    throw new Error('loadData not implemented - needs to be injected or moved to services package');
    // const dataRecords = await loadData({
    //   source: config.data.kind,
    //   ...config.data,
    // } as any);

    logStep(`Loaded ${dataRecords.length} data records`);

    // Test each strategy
    const results: StrategyOptimizationResult[] = [];
    const maxConcurrent = config.maxConcurrent || 1;

    // Create progress indicator for strategy testing
    const strategyProgress = createProgress({
      total: strategiesToTest.length,
      label: 'Testing strategies',
      showBar: true,
      showPercentage: true,
      showETA: true,
    });

    // Process strategies in batches
    for (let i = 0; i < strategiesToTest.length; i += maxConcurrent) {
      const batch = strategiesToTest.slice(i, i + maxConcurrent);
      const batchNum = Math.floor(i / maxConcurrent) + 1;
      const totalBatches = Math.ceil(strategiesToTest.length / maxConcurrent);

      logStep(`Testing batch ${batchNum}/${totalBatches}`, {
        strategies: batch.length,
        completed: results.length,
      });

      const batchResults = await Promise.all(
        batch.map(async (strategy, batchIdx) => {
          const strategyNum = i + batchIdx + 1;
          logStep(`Testing strategy ${strategyNum}/${strategiesToTest.length}`, {
            name: strategy.name,
          });

          const result = await this.testStrategy(strategy, dataRecords);
          strategyProgress.update(1);
          return result;
        })
      );
      results.push(...(batchResults.filter((r) => r !== null) as StrategyOptimizationResult[]));
    }

    strategyProgress.complete(`Tested ${results.length} strategies`);

    // Find best strategy
    logStep('Finding best strategy');
    const bestStrategy = this.findBestStrategy(results);

    // Calculate summary
    logStep('Calculating summary statistics');
    const summary = this.calculateSummary(results);

    const duration = Date.now() - startTime;
    logOperationComplete(`Optimization: ${config.name}`, duration);

    return {
      config,
      results,
      bestStrategy,
      summary,
    };
  }

  /**
   * Test a single strategy against data
   */
  private async testStrategy(
    strategy: StrategyConfig,
    dataRecords: any[]
  ): Promise<StrategyOptimizationResult | null> {
    // Validate strategy
    const validation = validateStrategy(strategy);
    if (!validation.valid) {
      console.warn(`Strategy ${strategy.name} is invalid:`, validation.errors);
      return null;
    }

    const trades: StrategyOptimizationResult['trades'] = [];
    let processed = 0;
    let skipped = 0;

    // Create progress for data record processing
    const recordProgress = createProgress({
      total: dataRecords.length,
      label: `  Testing ${strategy.name}`,
      showBar: false,
      showPercentage: true,
      updateInterval: 10, // Update more frequently for many records
    });

    // Test strategy on each data record
    for (let recordIdx = 0; recordIdx < dataRecords.length; recordIdx++) {
      const record = dataRecords[recordIdx];
      try {
        const mint = record.mint || record.tokenAddress;
        const chain = record.chain || 'solana';
        const timestamp =
          record.timestamp instanceof DateTime
            ? record.timestamp
            : DateTime.fromJSDate(record.timestamp);

        if (!mint || !timestamp.isValid) {
          skipped++;
          continue;
        }

        const endTime = (record.endTime as DateTime) || timestamp.plus({ days: 60 });
        // This optimizer is deprecated and violates architectural rules.
        // It should accept candles via dependency injection or be moved to @quantbot/workflows.
        throw new Error(
          'StrategyOptimizer.fetchHybridCandles is deprecated. ' +
            'This optimizer should accept candles via dependency injection or be moved to @quantbot/workflows. ' +
            'Import candles from @quantbot/ohlcv in the workflow layer instead.'
        );

        // Unreachable code - kept for type checking
        // This code is unreachable but kept for reference
        // @ts-expect-error - Unreachable code after throw
        const candles: Candle[] = [];

        // @ts-expect-error - Unreachable code after throw
        if (candles.length < 10) {
          skipped++;
          continue;
        }

        // @ts-expect-error - Unreachable code after throw
        // Build strategy parameters
        const strategyParams = buildStrategy(strategy);
        // @ts-expect-error - Unreachable code after throw
        const stopLossConfig = buildStopLossConfig(strategy);
        // @ts-expect-error - Unreachable code after throw
        const entryConfig = buildEntryConfig(strategy);
        // @ts-expect-error - Unreachable code after throw
        const reEntryConfig = buildReEntryConfig(strategy);

        // @ts-expect-error - Unreachable code after throw
        // Run simulation
        const result = await simulateStrategy(
          candles,
          strategyParams,
          stopLossConfig,
          entryConfig,
          reEntryConfig
        );

        // @ts-expect-error - Unreachable code after throw
        // Calculate additional metrics
        const firstCandle = candles[0];
        const maxReached = firstCandle
          ? Math.max(...candles.map((c) => c.high / firstCandle.open))
          : 0;
        const holdDuration =
          result.events.length > 0
            ? (result.events[result.events.length - 1].timestamp - result.events[0].timestamp) / 60
            : 0;
        const timeToAth = this.calculateTimeToAth(candles, result.events);

        trades.push({
          tokenAddress: mint,
          tokenSymbol: record.tokenSymbol,
          tokenName: record.tokenName,
          chain,
          caller: record.caller,
          alertTime: timestamp.toISO(),
          pnl: result.finalPnl,
          pnlPercent: (result.finalPnl - 1) * 100,
          maxReached,
          holdDuration,
          timeToAth,
          entryPrice: result.entryPrice,
          exitPrice: result.finalPrice,
          candlesCount: candles.length,
        });

        processed++;
        recordProgress.update(1);
      } catch (error) {
        skipped++;
        recordProgress.update(1);
        logError(`Record ${recordIdx + 1}`, error as Error, {
          strategy: strategy.name,
          record: recordIdx + 1,
        });
        continue;
      }
    }

    recordProgress.complete(`Processed ${processed} records (${skipped} skipped)`);

    // Calculate metrics
    const metrics = this.calculateMetrics(trades);

    return {
      strategy,
      metrics,
      trades,
    };
  }

  /**
   * Calculate performance metrics from trades
   */
  private calculateMetrics(trades: StrategyOptimizationResult['trades']) {
    if (trades.length === 0) {
      return {
        totalPnl: 0,
        totalPnlPercent: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        profitFactor: 0,
        avgHoldDuration: 0,
        avgTimeToAth: 0,
      };
    }

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1), 0);
    const totalPnlPercent = (totalPnl / trades.length) * 100;
    const winningTrades = trades.filter((t) => t.pnl > 1).length;
    const losingTrades = trades.length - winningTrades;
    const winRate = (winningTrades / trades.length) * 100;

    const wins = trades.filter((t) => t.pnl > 1);
    const losses = trades.filter((t) => t.pnl <= 1);
    const avgWin =
      wins.length > 0 ? wins.reduce((sum, t) => sum + (t.pnl - 1), 0) / wins.length : 0;
    const avgLoss =
      losses.length > 0 ? losses.reduce((sum, t) => sum + (1 - t.pnl), 0) / losses.length : 0;

    const profitFactor = avgLoss > 0 ? (avgWin * winningTrades) / (avgLoss * losingTrades) : 0;

    // Calculate drawdown (simplified)
    let maxDrawdown = 0;
    let peak = 1;
    let cumulative = 1;
    for (const trade of trades) {
      cumulative *= trade.pnl;
      if (cumulative > peak) peak = cumulative;
      const drawdown = (peak - cumulative) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Calculate Sharpe ratio (simplified - would need risk-free rate)
    const returns = trades.map((t) => t.pnl - 1);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    const avgHoldDuration = trades.reduce((sum, t) => sum + t.holdDuration, 0) / trades.length;
    const avgTimeToAth = trades.reduce((sum, t) => sum + t.timeToAth, 0) / trades.length;

    return {
      totalPnl,
      totalPnlPercent,
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      winRate,
      avgWin,
      avgLoss,
      maxDrawdown,
      sharpeRatio,
      profitFactor,
      avgHoldDuration,
      avgTimeToAth,
    };
  }

  /**
   * Calculate time to ATH (all-time high)
   */
  private calculateTimeToAth(candles: any[], events: any[]): number {
    if (candles.length === 0 || events.length === 0) return 0;

    const entryTime = events[0].timestamp;
    let ath = candles[0].open;
    let athTime = entryTime;

    for (const candle of candles) {
      if (candle.high > ath) {
        ath = candle.high;
        athTime = candle.timestamp;
      }
    }

    return (athTime - entryTime) / 60; // Return in minutes
  }

  /**
   * Find the best strategy from results
   */
  private findBestStrategy(
    results: StrategyOptimizationResult[]
  ): StrategyOptimizationResult | null {
    if (results.length === 0) return null;

    // Sort by total PnL percent
    const sorted = [...results].sort(
      (a, b) => b.metrics.totalPnlPercent - a.metrics.totalPnlPercent
    );

    return sorted[0];
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(results: StrategyOptimizationResult[]) {
    if (results.length === 0) {
      return {
        totalStrategiesTested: 0,
        bestPnl: 0,
        bestWinRate: 0,
        bestProfitFactor: 0,
        averagePnl: 0,
      };
    }

    const pnls = results.map((r) => r.metrics.totalPnlPercent);
    const winRates = results.map((r) => r.metrics.winRate);
    const profitFactors = results.map((r) => r.metrics.profitFactor);

    return {
      totalStrategiesTested: results.length,
      bestPnl: Math.max(...pnls),
      bestWinRate: Math.max(...winRates),
      bestProfitFactor: Math.max(...profitFactors),
      averagePnl: pnls.reduce((sum, p) => sum + p, 0) / pnls.length,
    };
  }
}
