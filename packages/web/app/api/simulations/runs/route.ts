/**
 * Simulation Runs API Route
 * GET /api/simulations/runs - List simulation runs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDuckDBClient } from '@quantbot/storage';
import { getDuckDBPath } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';

const SimulationRunSchema = z.object({
  run_id: z.string(),
  strategy_id: z.string(),
  strategy_name: z.string(),
  caller_name: z.string().nullable(),
  from_iso: z.string(),
  to_iso: z.string(),
  total_calls: z.number().nullable(),
  successful_calls: z.number().nullable(),
  failed_calls: z.number().nullable(),
  total_trades: z.number().nullable(),
  pnl_min: z.number().nullable(),
  pnl_max: z.number().nullable(),
  pnl_mean: z.number().nullable(),
  pnl_median: z.number().nullable(),
  created_at: z.string(),
});

const SimulationRunsResponseSchema = z.array(SimulationRunSchema);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const strategyName = searchParams.get('strategyName');
    const callerName = searchParams.get('callerName');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const dbPath = getDuckDBPath('data/tele.duckdb');
    const client = getDuckDBClient(dbPath);
    // Use relative path - PythonEngine will resolve from workspace root
    const scriptPath = 'tools/storage/duckdb_simulation_runs.py';

    // Build query parameters
    const params: Record<string, unknown> = {
      limit,
      offset,
    };

    if (strategyName) {
      params.strategy_name = strategyName;
    }
    if (callerName) {
      params.caller_name = callerName;
    }
    if (from) {
      params.from_iso = from;
    }
    if (to) {
      params.to_iso = to;
    }

    const runs = await client.execute(scriptPath, 'list', params, SimulationRunsResponseSchema);

    return NextResponse.json({
      runs: runs || [],
      total: runs?.length || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Simulation runs API error:', error);
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

