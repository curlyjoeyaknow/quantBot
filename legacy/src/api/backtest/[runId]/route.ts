/**
 * Backtest Result API
 * 
 * GET /api/backtest/:runId - Get backtest results
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSimulationRun, getSimulationEvents } from '../../../utils/database';
import { logger } from '../../../utils/logger';

/**
 * GET /api/backtest/:runId - Get backtest results
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const runId = parseInt(params.runId, 10);
    if (isNaN(runId)) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
    }

    const run = await getSimulationRun(runId);
    if (!run) {
      return NextResponse.json({ error: 'Backtest run not found' }, { status: 404 });
    }

    const events = await getSimulationEvents(runId);

    return NextResponse.json({
      run: {
        id: run.id,
        userId: run.userId,
        mint: run.mint,
        chain: run.chain,
        tokenName: run.tokenName,
        tokenSymbol: run.tokenSymbol,
        startTime: run.startTime,
        endTime: run.endTime,
        strategy: run.strategy,
        stopLossConfig: run.stopLossConfig,
        strategyName: run.strategyName,
        finalPnl: run.finalPnl,
        totalCandles: run.totalCandles,
        entryType: run.entryType,
        entryPrice: run.entryPrice,
        entryTimestamp: run.entryTimestamp,
        filterCriteria: run.filterCriteria,
        createdAt: run.createdAt,
      },
      events,
    });
  } catch (error: any) {
    logger.error('Error fetching backtest result', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch backtest result' },
      { status: 500 }
    );
  }
}

