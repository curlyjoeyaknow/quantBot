/**
 * Handler: Verify OHLCV Fetch
 * 
 * Tests Birdeye API fetch for a single token and validates the results.
 */

import { DateTime } from 'luxon';
import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { PythonEngine } from '@quantbot/utils';
import { logger } from '@quantbot/utils';

export interface VerifyOhlcvFetchArgs {
  mint: string;
  fromDate?: string;  // ISO date string
  toDate?: string;    // ISO date string
  hours?: number;     // Or specify hours back from now
  interval?: '1s' | '15s' | '1m' | '5m' | '15m' | '1h';
  chain?: string;
}

export interface VerifyOhlcvFetchResult {
  success: boolean;
  mint: string;
  timeRange: {
    from: string;
    to: string;
  };
  interval: string;
  candlesFetched: number;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  candles?: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  error?: string;
}

export async function verifyOhlcvFetchHandler(
  args: VerifyOhlcvFetchArgs,
  ctx: CommandContext
): Promise<VerifyOhlcvFetchResult> {
  const interval = args.interval || '1m';
  const chain = args.chain || 'solana';
  
  // Determine time range
  let fromTime: DateTime;
  let toTime: DateTime;
  
  if (args.fromDate && args.toDate) {
    fromTime = DateTime.fromISO(args.fromDate);
    toTime = DateTime.fromISO(args.toDate);
  } else if (args.hours) {
    toTime = DateTime.now();
    fromTime = toTime.minus({ hours: args.hours });
  } else {
    // Default: 1 hour back
    toTime = DateTime.now();
    fromTime = toTime.minus({ hours: 1 });
  }
  
  const fromUnix = Math.floor(fromTime.toSeconds());
  const toUnix = Math.floor(toTime.toSeconds());
  
  logger.info('Verifying OHLCV fetch', {
    mint: args.mint,
    interval,
    from: fromTime.toISO(),
    to: toTime.toISO(),
  });
  
  try {
    const pythonEngine = new PythonEngine();
    
    // Define schema for Python script output
    const outputSchema = z.object({
      success: z.boolean(),
      count: z.number(),
      candles: z.array(z.object({
        timestamp: z.number(),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number(),
      })),
      validation: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
      error: z.string().optional(),
    });
    
    const result = await pythonEngine.runScript(
      'tools/validation/verify_ohlcv_fetch.py',
      {
        mint: args.mint,
        'from-unix': fromUnix.toString(),
        'to-unix': toUnix.toString(),
        interval,
        chain,
      },
      outputSchema,
      { 
        timeout: 60000,
        env: {
          ...process.env,
          BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || '',
        }
      }
    );
    
    return {
      success: result.success,
      mint: args.mint,
      timeRange: {
        from: fromTime.toISO()!,
        to: toTime.toISO()!,
      },
      interval,
      candlesFetched: result.count || 0,
      validation: result.validation || {
        valid: false,
        errors: ['No validation data'],
        warnings: [],
      },
      candles: result.candles,
      error: result.error,
    };
  } catch (error) {
    logger.error('Failed to verify OHLCV fetch', error as Error);
    
    return {
      success: false,
      mint: args.mint,
      timeRange: {
        from: fromTime.toISO()!,
        to: toTime.toISO()!,
      },
      interval,
      candlesFetched: 0,
      validation: {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

