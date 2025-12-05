/**
 * Backtest Charts API
 * 
 * GET /api/backtest/:runId/charts - Get chart data for visualization
 */

import { NextRequest, NextResponse } from 'next/server';
import { resultsService } from '../../../services/results-service';
import { logger } from '../../../utils/logger';

/**
 * GET /api/backtest/:runId/charts - Get chart data for visualization
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

    const chartData = await resultsService.generateChartData(runId);

    return NextResponse.json({
      runId,
      charts: chartData,
    });
  } catch (error: any) {
    logger.error('Error generating chart data', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate chart data' },
      { status: 500 }
    );
  }
}

