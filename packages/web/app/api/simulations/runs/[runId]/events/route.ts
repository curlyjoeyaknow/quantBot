/**
 * Simulation Events API Route
 * GET /api/simulations/runs/[runId]/events - Get simulation events for a run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@quantbot/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const tokenAddress = searchParams.get('tokenAddress');
    const limit = parseInt(searchParams.get('limit') || '1000', 10);

    const runIdNum = parseInt(runId, 10);

    if (isNaN(runIdNum)) {
      return NextResponse.json(
        {
          error: {
            message: 'Invalid run ID',
            code: 400,
          },
        },
        { status: 400 }
      );
    }

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    let query = `
      SELECT 
        simulation_run_id,
        token_address,
        chain,
        event_time,
        seq,
        event_type,
        price,
        size,
        remaining_position,
        pnl_so_far,
        indicators_json,
        position_state_json,
        metadata_json
      FROM ${CLICKHOUSE_DATABASE}.simulation_events
      WHERE simulation_run_id = {runId:UInt64}
    `;

    const queryParams: Record<string, unknown> = {
      runId: runIdNum,
    };

    if (tokenAddress) {
      query += ` AND token_address = {tokenAddress:String}`;
      queryParams.tokenAddress = tokenAddress;
    }

    query += ` ORDER BY seq ASC LIMIT {limit:UInt32}`;
    queryParams.limit = limit;

    const eventsResult = await ch.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    type EventRow = {
      simulation_run_id: number;
      token_address: string;
      chain: string;
      event_time: string;
      seq: number;
      event_type: string;
      price: number;
      size: number;
      remaining_position: number;
      pnl_so_far: number;
      indicators_json: string;
      position_state_json: string;
      metadata_json: string;
    };

    const events = (await eventsResult.json()) as EventRow[];

    // Parse JSON fields
    const parsedEvents = Array.isArray(events) ? events.map((event: EventRow) => {
      let indicators: unknown = null;
      let positionState: unknown = null;
      let metadata: unknown = null;
      
      try {
        indicators = event.indicators_json && typeof event.indicators_json === 'string' 
          ? JSON.parse(event.indicators_json) 
          : null;
      } catch {
        // Ignore parse errors
      }
      
      try {
        positionState = event.position_state_json && typeof event.position_state_json === 'string'
          ? JSON.parse(event.position_state_json)
          : null;
      } catch {
        // Ignore parse errors
      }
      
      try {
        metadata = event.metadata_json && typeof event.metadata_json === 'string'
          ? JSON.parse(event.metadata_json)
          : null;
      } catch {
        // Ignore parse errors
      }
      
      return {
        ...event,
        indicators,
        positionState,
        metadata,
      };
    }) : [];

    return NextResponse.json({
      runId,
      events: parsedEvents,
      total: parsedEvents.length,
    });
  } catch (error) {
    console.error('Simulation events API error:', error);
    return NextResponse.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}

