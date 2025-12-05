/**
 * Backtest Runner
 * 
 * Shared logic for running single backtests
 */

import { DateTime } from 'luxon';
import {
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../../simulation/config';
import { SimulationEngine } from '../../simulation/engine';
import { ohlcvService } from '../../services/ohlcv-service';
import { tokenService } from '../../services/token-service';
import { determineEntryPrice, type EntryType } from './entry-price-service';
import { saveSimulationRun } from '../../utils/database';
import { logger } from '../../utils/logger';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'simulations.db');

export interface BacktestRunParams {
  userId: number;
  mint: string;
  chain: string;
  strategyId: number;
  stopLossConfig?: StopLossConfig;
  entryConfig?: EntryConfig;
  reEntryConfig?: ReEntryConfig;
  costConfig?: CostConfig;
  entryType?: EntryType;
  entryTime?: DateTime;
  startTime?: DateTime;
  endTime?: DateTime;
  durationHours?: number;
}

export interface BacktestRunResult {
  runId: number;
  result: any;
  entryPrice: any;
  token: any;
  timeRange: any;
}

/**
 * Run a single backtest
 */
export async function runSingleBacktest(
  params: BacktestRunParams
): Promise<BacktestRunResult> {
  // Get strategy by ID
  const strategy = await getStrategyById(params.strategyId, params.userId);
  if (!strategy) {
    throw new Error('Strategy not found');
  }

  // Ensure token is in registry
  await tokenService.addToken(params.mint, params.chain, params.userId);

  // Determine time range
  const entryTime = params.entryTime || DateTime.utc();
  const endTime =
    params.endTime || entryTime.plus({ hours: params.durationHours || 24 });
  const startTime =
    params.startTime || entryTime.minus({ hours: 1 }); // 1 hour before entry for lookback

  // Determine entry price
  const entryPriceResult = await determineEntryPrice(
    params.mint,
    params.chain,
    entryTime,
    params.entryType || 'alert'
  );

  // Fetch candles
  const candles = await ohlcvService.getCandles(
    params.mint,
    params.chain,
    startTime,
    endTime,
    {
      interval: '5m',
      useCache: true,
      alertTime: entryTime,
    }
  );

  if (candles.length === 0) {
    throw new Error('No candle data available for the specified time range');
  }

  // Run simulation
  const { simulateStrategy } = await import('../../simulation/engine');

  const result = simulateStrategy(
    candles,
    strategy.strategy,
    params.stopLossConfig,
    params.entryConfig,
    params.reEntryConfig,
    params.costConfig
  );

  // Get token metadata
  const token = await tokenService.getToken(params.mint, params.chain);

  // Save simulation run
  const runId = await saveSimulationRun({
    userId: params.userId,
    mint: params.mint,
    chain: params.chain,
    tokenName: token?.tokenName,
    tokenSymbol: token?.tokenSymbol,
    startTime,
    endTime,
    strategy: strategy.strategy,
    stopLossConfig: params.stopLossConfig || { initial: -0.5, trailing: 'none' },
    finalPnl: result.finalPnl,
    totalCandles: result.totalCandles,
    events: result.events,
    entryType: entryPriceResult.entryType,
    entryPrice: entryPriceResult.entryPrice,
    entryTimestamp: entryPriceResult.entryTimestamp,
    strategyName: strategy.name,
  });

  return {
    runId,
    result: {
      finalPnl: result.finalPnl,
      entryPrice: result.entryPrice,
      finalPrice: result.finalPrice,
      totalCandles: result.totalCandles,
      entryOptimization: result.entryOptimization,
      events: result.events,
    },
    entryPrice: {
      price: entryPriceResult.entryPrice,
      timestamp: entryPriceResult.entryTimestamp,
      type: entryPriceResult.entryType,
      source: entryPriceResult.source,
    },
    token: {
      mint: params.mint,
      chain: params.chain,
      name: token?.tokenName,
      symbol: token?.tokenSymbol,
    },
    timeRange: {
      start: startTime.toISO(),
      end: endTime.toISO(),
      entry: entryTime.toISO(),
    },
  };
}

/**
 * Get strategy by ID
 */
async function getStrategyById(id: number, userId: number): Promise<any | null> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }

      db.get(
        'SELECT * FROM strategies WHERE id = ? AND user_id = ?',
        [id, userId],
        (err, row: any) => {
          db.close();
          if (err) {
            return reject(err);
          }
          if (!row) {
            return resolve(null);
          }

          resolve({
            id: row.id,
            userId: row.user_id,
            name: row.name,
            description: row.description,
            strategy: JSON.parse(row.strategy),
            stopLossConfig: JSON.parse(row.stop_loss_config),
            isDefault: row.is_default === 1,
            createdAt: row.created_at,
          });
        }
      );
    });
  });
}

