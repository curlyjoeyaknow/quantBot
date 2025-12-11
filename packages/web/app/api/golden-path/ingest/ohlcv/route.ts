/**
 * API endpoint for OHLCV ingestion
 * 
 * POST /api/golden-path/ingest/ohlcv
 * 
 * Body:
 * {
 *   from?: string (ISO date),
 *   to?: string (ISO date),
 *   preWindowMinutes?: number,
 *   postWindowMinutes?: number,
 *   interval?: '1m' | '5m'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import { CallsRepository, OhlcvRepository } from '@quantbot/data';
import { logger } from '@quantbot/utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      from,
      to,
      preWindowMinutes = 260,
      postWindowMinutes = 1440,
      interval = '5m',
    } = body;

    logger.info('Starting OHLCV ingestion via API', {
      from,
      to,
      preWindowMinutes,
      postWindowMinutes,
      interval,
    });

    // Initialize repositories
    const callsRepo = new CallsRepository();
    const ohlcvRepo = new OhlcvRepository();

    // Initialize service
    const ingestionService = new OhlcvIngestionService(callsRepo, ohlcvRepo);

    // Run ingestion
    const result = await ingestionService.ingestForCalls({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      preWindowMinutes,
      postWindowMinutes,
      interval: interval as '1m' | '5m',
    });

    return NextResponse.json({
      success: true,
      result: {
        tokensProcessed: result.tokensProcessed,
        candlesInserted: result.candlesInserted,
        skippedTokens: result.skippedTokens,
      },
    });
  } catch (error) {
    logger.error('OHLCV ingestion API error', error as Error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

