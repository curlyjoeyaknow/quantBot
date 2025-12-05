/**
 * Mini App Backtest API
 * =====================
 * Handles backtest requests from the Telegram Mini App.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { withValidation } from '@/lib/middleware/validation';
import { z } from 'zod';
// Note: These imports will need to be implemented or use API calls to the bot service
// For now, we'll create a stub that calls the bot service API
// import { simulateStrategy, Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '@/lib/simulation/engine';
// import { fetchHybridCandles } from '@/lib/simulation/candles';
import { DateTime } from 'luxon';

const BacktestRequestSchema = z.object({
  userId: z.number(),
  mint: z.string().min(1),
  chain: z.string().default('solana'),
  strategy: z.array(z.object({
    percent: z.number().min(0).max(1),
    target: z.number().positive(),
  })),
  stopLoss: z.object({
    initial: z.number().min(-0.99).max(0),
    trailing: z.union([z.number().min(0).max(10), z.literal('none')]).default('none'),
  }),
  entryConfig: z.object({
    initialEntry: z.union([z.number().min(-0.99).max(0), z.literal('none')]).default('none'),
    trailingEntry: z.union([z.number().min(0).max(5), z.literal('none')]).default('none'),
    maxWaitTime: z.number().int().min(1).max(24 * 7).default(60),
  }).optional(),
  reEntryConfig: z.object({
    trailingReEntry: z.union([z.number().min(0).max(0.99), z.literal('none')]).default('none'),
    maxReEntries: z.number().int().min(0).max(10).default(0),
    sizePercent: z.number().min(0).max(1).default(0.5),
  }).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export const POST = withErrorHandling(
  withValidation({ body: BacktestRequestSchema })(async (request: NextRequest, validated) => {
    const data = validated.body!;
    const {
      userId,
      mint,
      chain,
      strategy,
      stopLoss,
      entryConfig,
      reEntryConfig,
      startTime,
      endTime,
    } = data;

    try {
      // Determine time range
      const endDateTime = endTime ? DateTime.fromISO(endTime) : DateTime.utc();
      const startDateTime = startTime
        ? DateTime.fromISO(startTime)
        : endDateTime.minus({ days: 7 }); // Default to 7 days back

      // TODO: Call bot service API to run simulation
      // For now, return a placeholder response
      // In production, this should call the bot service's simulation API
      
      // Option 1: Call bot service API (recommended)
      // const botServiceUrl = process.env.BOT_SERVICE_URL || 'http://localhost:3001';
      // const response = await fetch(`${botServiceUrl}/api/simulate`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ mint, chain, strategy, stopLoss, entryConfig, reEntryConfig, startTime, endTime }),
      // });
      // const result = await response.json();

      // Option 2: Use local simulation engine (if copied to web app)
      // For now, return error indicating this needs to be implemented
      return NextResponse.json(
        { error: { message: 'Simulation engine not yet integrated. Please use the bot commands for now.' } },
        { status: 501 }
      );
    } catch (error: any) {
      return NextResponse.json(
        { error: { message: error.message || 'Failed to run backtest' } },
        { status: 500 }
      );
    }
  })
);

