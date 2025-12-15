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
// eslint-disable-next-line no-restricted-imports
import { fetchHybridCandles } from '@quantbot/ohlcv';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

// TODO: loadData should be part of @quantbot/services or removed
// import { loadData } from '../../data/loaders';

export class StrategyOptimizer {
  /**
   * Run optimization with given configuration
   */
  async optimize(config: OptimizationConfig): Promise<OptimizationRunResult> {
    // Generate strategy combinations
    const strategies = generateParameterCombinations(config.parameterGrid, config.baseStrategy);

    // Limit strategies if specified
    const strategiesToTest = config.maxStrategies
      ? strategies.slice(0, config.maxStrategies)
      : strategies;

    // Load data
    // TODO: Implement data loading from config or inject as dependency
    const dataRecords: any[] = [];
    throw new Error('loadData not implemented - needs to be injected or moved to services package');
    // const dataRecords = await loadData({
    //   source: config.data.kind,
    //   ...config.data,
    // } as any);

    // Test each strategy
    const results: StrategyOptimizationResult[] = [];
    const maxConcurrent = config.maxConcurrent || 1;

    // Process strategies in batches
    for (let i = 0; i < strategiesToTest.length; i += maxConcurrent) {
      const batch = strategiesToTest.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((strategy) => this.testStrategy(strategy, dataRecords))
      );
      results.push(...(batchResults.filter((r) => r !== null) as StrategyOptimizationResult[]));
    }

    // Find best strategy
    const bestStrategy = this.findBestStrategy(results);

    // Calculate summary
    const summary = this.calculateSummary(results);

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

    // Test strategy on each data record
    for (const record of dataRecords) {
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
        // Pass timestamp as alertTime for 1m candles around alert time
        const candles = await fetchHybridCandles(mint, timestamp, endTime, chain, timestamp);

        if (candles.length < 10) {
          skipped++;
          continue;
        }

        // Build strategy parameters
        const strategyParams = buildStrategy(strategy);
        const stopLossConfig = buildStopLossConfig(strategy);
        const entryConfig = buildEntryConfig(strategy);
        const reEntryConfig = buildReEntryConfig(strategy);

        // Run simulation
        const result = await simulateStrategy(
          candles,
          strategyParams,
          stopLossConfig,
          entryConfig,
          reEntryConfig
        );

        // Calculate additional metrics
        const maxReached = Math.max(...candles.map((c) => c.high / candles[0].open));
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
      } catch (error) {
        skipped++;
        continue;
      }
    }

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
