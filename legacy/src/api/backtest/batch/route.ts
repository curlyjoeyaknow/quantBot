/**
 * Batch Backtest API
 * 
 * POST /api/backtest/batch - Run backtest on multiple tokens
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
} from '../../../simulation/config';
import { tokenFilterService } from '../../../services/token-filter-service';
import { logger } from '../../../utils/logger';

const BatchBacktestRequestSchema = z.object({
  userId: z.number().int().positive(),
  strategyId: z.number().int().positive(),
  filterCriteria: z.object({
    chain: z.string().optional(),
    dateRange: z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    }).optional(),
    caller: z.string().optional(),
    hasCandleData: z.boolean().optional().default(true),
    limit: z.number().int().min(1).max(100).optional().default(50),
  }).optional(),
  stopLossConfig: StopLossConfigSchema.optional(),
  entryConfig: EntryConfigSchema.optional(),
  reEntryConfig: ReEntryConfigSchema.optional(),
  costConfig: CostConfigSchema.optional(),
  entryType: z.enum(['alert', 'time', 'manual']).default('alert'),
  maxConcurrency: z.number().int().min(1).max(10).optional().default(4),
});

/**
 * POST /api/backtest/batch - Run backtest on multiple tokens
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = BatchBacktestRequestSchema.parse(body);

    // Import backtest runner
    const { runSingleBacktest } = await import('../backtest-runner');

    // Get filtered tokens
    const filters = validated.filterCriteria || {};
    const tokens = await tokenFilterService.filterTokens({
      chain: filters.chain,
      dateRange: filters.dateRange
        ? {
            start: DateTime.fromISO(filters.dateRange.start),
            end: DateTime.fromISO(filters.dateRange.end),
          }
        : undefined,
      caller: filters.caller,
      hasCandleData: filters.hasCandleData,
      limit: filters.limit,
    });

    if (tokens.length === 0) {
      return NextResponse.json(
        { error: 'No tokens found matching filter criteria' },
        { status: 404 }
      );
    }

    // Run backtests in batches
    const concurrency = validated.maxConcurrency || 4;
    const results: Array<{
      token: { mint: string; chain: string };
      success: boolean;
      runId?: number;
      error?: string;
      result?: any;
    }> = [];

    for (let i = 0; i < tokens.length; i += concurrency) {
      const batch = tokens.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map(async (token) => {
          try {
            const result = await runSingleBacktest({
              userId: validated.userId,
              mint: token.mint,
              chain: token.chain,
              strategyId: validated.strategyId,
              stopLossConfig: validated.stopLossConfig,
              entryConfig: validated.entryConfig,
              reEntryConfig: validated.reEntryConfig,
              costConfig: validated.costConfig,
              entryType: validated.entryType,
            });

            return {
              token: { mint: token.mint, chain: token.chain },
              success: true,
              runId: result.runId,
              result: result.result,
            };
          } catch (error: any) {
            return {
              token: { mint: token.mint, chain: token.chain },
              success: false,
              error: error.message,
            };
          }
        })
      );

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          results.push(batchResult.value);
        } else {
          results.push({
            token: { mint: 'unknown', chain: 'unknown' },
            success: false,
            error: batchResult.reason?.message || 'Unknown error',
          });
        }
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      total: results.length,
      successful,
      failed,
      results,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Error running batch backtest', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to run batch backtest' },
      { status: 500 }
    );
  }
}

