/**
 * Simulation Run Detail API Route
 * GET /api/simulations/runs/[runId] - Get simulation run details
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDuckDBClient } from '@quantbot/storage';
import { join } from 'path';
import { z } from 'zod';

const SimulationRunDetailSchema = z.object({
  run_id: z.string(),
  strategy_id: z.string(),
  strategy_name: z.string(),
  strategy_config: z.record(z.string(), z.unknown()),
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    const dbPath = process.env.DUCKDB_PATH || 'data/result.duckdb';
    const client = getDuckDBClient(dbPath);
    const scriptPath = join(process.cwd(), 'tools/storage/duckdb_simulation_runs.py');

    const run = await client.execute(
      scriptPath,
      'get',
      { run_id: runId },
      SimulationRunDetailSchema
    );

    if (!run) {
      return NextResponse.json(
        {
          error: {
            message: 'Simulation run not found',
            code: 404,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(run);
  } catch (error) {
    console.error('Simulation run detail API error:', error);
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

