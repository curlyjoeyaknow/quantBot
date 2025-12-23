/**
 * Simulation Results API Route
 * GET /api/simulations/runs/[runId]/results - Get simulation results for a run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@quantbot/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
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

    // Query simulation aggregates
    const aggregatesResult = await ch.query({
      query: `
        SELECT 
          token_address,
          chain,
          final_pnl,
          max_drawdown,
          volatility,
          sharpe_ratio,
          sortino_ratio,
          win_rate,
          trade_count,
          reentry_count,
          ladder_entries_used,
          ladder_exits_used
        FROM ${CLICKHOUSE_DATABASE}.simulation_aggregates
        WHERE simulation_run_id = {runId:UInt64}
        ORDER BY final_pnl DESC
      `,
      query_params: {
        runId: runIdNum,
      },
      format: 'JSONEachRow',
    });

    const aggregates = await aggregatesResult.json<Array<{
      token_address: string;
      chain: string;
      final_pnl: number;
      max_drawdown: number;
      volatility: number;
      sharpe_ratio: number;
      sortino_ratio: number;
      win_rate: number;
      trade_count: number;
      reentry_count: number;
      ladder_entries_used: number;
      ladder_exits_used: number;
    }>>();

    return NextResponse.json({
      runId,
      results: aggregates || [],
      total: aggregates?.length || 0,
    });
  } catch (error) {
    console.error('Simulation results API error:', error);
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

