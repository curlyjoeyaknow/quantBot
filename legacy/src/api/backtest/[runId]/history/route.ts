/**
 * Backtest History API
 * 
 * GET /api/backtest/:runId/history - Get complete trade history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSimulationEvents } from '../../../utils/database';
import { logger } from '../../../utils/logger';

/**
 * GET /api/backtest/:runId/history - Get complete trade history
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

    const events = await getSimulationEvents(runId);

    // Group events by type for easier analysis
    const groupedEvents = {
      entries: events.filter((e) => e.event_type === 'entry' || e.event_type === 'trailing_entry_triggered'),
      exits: events.filter((e) => e.event_type === 'target_hit' || e.event_type === 'stop_loss' || e.event_type === 'final_exit'),
      stops: events.filter((e) => e.event_type === 'stop_moved'),
      reEntries: events.filter((e) => e.event_type === 're_entry'),
    };

    return NextResponse.json({
      runId,
      totalEvents: events.length,
      events,
      groupedEvents,
    });
  } catch (error: any) {
    logger.error('Error fetching backtest history', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch backtest history' },
      { status: 500 }
    );
  }
}

