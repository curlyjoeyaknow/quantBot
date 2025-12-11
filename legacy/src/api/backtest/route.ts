/**
 * Backtest API
 * 
 * POST /api/backtest/run - Execute single backtest
 */

import { NextRequest, NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  StrategyLegSchema,
  StopLossConfigSchema,
  EntryConfigSchema,
  ReEntryConfigSchema,
  CostConfigSchema,
} from '../../simulation/config';
import { ohlcvService } from '../../services/ohlcv-service';
import { tokenService } from '../../services/token-service';
import { determineEntryPrice, type EntryType } from './entry-price-service';
import { saveSimulationRun } from '../../utils/database';
import { logger } from '../../utils/logger';

const BacktestRequestSchema = z.object({
  userId: z.number().int().positive(),
  mint: z.string().min(32),
  chain: z.string().default('solana'),
  strategyId: z.number().int().positive().optional(),
  strategy: z.array(StrategyLegSchema).optional(),
  stopLossConfig: StopLossConfigSchema.optional(),
  entryConfig: EntryConfigSchema.optional(),
  reEntryConfig: ReEntryConfigSchema.optional(),
  costConfig: CostConfigSchema.optional(),
  entryType: z.enum(['alert', 'time', 'manual']).default('alert'),
  entryTime: z.string().datetime().optional(), // ISO datetime string
  manualEntryPrice: z.number().positive().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  durationHours: z.number().int().min(1).max(24 * 90).optional().default(24),
});

/**
 * POST /api/backtest/run - Execute single backtest
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = BacktestRequestSchema.parse(body);

    // Use strategy ID or create temporary strategy
    if (validated.strategyId) {
      const result = await runSingleBacktest({
        userId: validated.userId,
        mint: validated.mint,
        chain: validated.chain,
        strategyId: validated.strategyId,
        stopLossConfig: validated.stopLossConfig,
        entryConfig: validated.entryConfig,
        reEntryConfig: validated.reEntryConfig,
        costConfig: validated.costConfig,
        entryType: validated.entryType as EntryType,
        entryTime: validated.entryTime
          ? DateTime.fromISO(validated.entryTime)
          : undefined,
        startTime: validated.startTime
          ? DateTime.fromISO(validated.startTime)
          : undefined,
        endTime: validated.endTime
          ? DateTime.fromISO(validated.endTime)
          : undefined,
        durationHours: validated.durationHours,
      });

      return NextResponse.json(result);
    } else if (validated.strategy) {
      // For inline strategy, we need to run it directly
      // This is a simplified version - in production, you might want to save it first
      const entryTime = validated.entryTime
        ? DateTime.fromISO(validated.entryTime)
        : DateTime.utc();

      const endTime = validated.endTime
        ? DateTime.fromISO(validated.endTime)
        : entryTime.plus({ hours: validated.durationHours });

      const startTime = validated.startTime
        ? DateTime.fromISO(validated.startTime)
        : entryTime.minus({ hours: 1 });

      const entryPriceResult = await determineEntryPrice(
        validated.mint,
        validated.chain,
        entryTime,
        validated.entryType as EntryType,
        validated.manualEntryPrice
      );

      const candles = await ohlcvService.getCandles(
        validated.mint,
        validated.chain,
        startTime,
        endTime,
        {
          interval: '5m',
          useCache: true,
          alertTime: entryTime,
        }
      );

      if (candles.length === 0) {
        return NextResponse.json(
          { error: 'No candle data available' },
          { status: 404 }
        );
      }

      const { simulateStrategy } = await import('../../simulation/engine');
      const result = simulateStrategy(
        candles,
        validated.strategy,
        validated.stopLossConfig,
        validated.entryConfig,
        validated.reEntryConfig,
        validated.costConfig
      );

      const token = await tokenService.getToken(validated.mint, validated.chain);

      const runId = await saveSimulationRun({
        userId: validated.userId,
        mint: validated.mint,
        chain: validated.chain,
        tokenName: token?.tokenName,
        tokenSymbol: token?.tokenSymbol,
        startTime,
        endTime,
        strategy: validated.strategy,
        stopLossConfig: validated.stopLossConfig || { initial: -0.5, trailing: 'none' },
        finalPnl: result.finalPnl,
        totalCandles: result.totalCandles,
        events: result.events,
        entryType: entryPriceResult.entryType,
        entryPrice: entryPriceResult.entryPrice,
        entryTimestamp: entryPriceResult.entryTimestamp,
      });

      return NextResponse.json({
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
          mint: validated.mint,
          chain: validated.chain,
          name: token?.tokenName,
          symbol: token?.tokenSymbol,
        },
        timeRange: {
          start: startTime.toISO(),
          end: endTime.toISO(),
          entry: entryTime.toISO(),
        },
      });
    } else {
      return NextResponse.json(
        { error: 'Either strategyId or strategy is required' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Error running backtest', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to run backtest' },
      { status: 500 }
    );
  }
}

