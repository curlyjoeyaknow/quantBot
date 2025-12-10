/**
 * API endpoint for Telegram export ingestion
 * 
 * POST /api/golden-path/ingest/telegram
 * 
 * Body:
 * {
 *   filePath: string,
 *   callerName: string,
 *   chain?: 'SOL',
 *   chatId?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { TelegramAlertIngestionService } from '@quantbot/services/ingestion/TelegramAlertIngestionService';
import { CallersRepository, TokensRepository, AlertsRepository, CallsRepository } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/utils/types/core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filePath, callerName, chain = 'SOL', chatId } = body;

    if (!filePath || !callerName) {
      return NextResponse.json(
        { error: 'filePath and callerName are required' },
        { status: 400 }
      );
    }

    logger.info('Starting Telegram ingestion via API', { filePath, callerName, chain });

    // Initialize repositories (they use pool directly, no client needed)
    const callersRepo = new CallersRepository();
    const tokensRepo = new TokensRepository();
    const alertsRepo = new AlertsRepository();
    const callsRepo = new CallsRepository();

    // Initialize service
    const ingestionService = new TelegramAlertIngestionService(
      callersRepo,
      tokensRepo,
      alertsRepo,
      callsRepo
    );

    // Run ingestion
    const result = await ingestionService.ingestExport({
      filePath,
      callerName,
      chain: chain as Chain,
      chatId,
    });

    return NextResponse.json({
      success: true,
      result: {
        alertsInserted: result.alertsInserted,
        callsInserted: result.callsInserted,
        tokensUpserted: result.tokensUpserted,
        skippedMessages: result.skippedMessages,
        skippedCalls: result.skippedCalls,
      },
    });
  } catch (error) {
    logger.error('Telegram ingestion API error', error as Error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

