/**
 * Simulation service - Direct service calls for server components
 * 
 * Calls DuckDB directly instead of using API routes to avoid circular dependencies
 */

import { getDuckDBClient } from '@quantbot/storage';
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

interface SimulationRun {
  run_id: string;
  strategy_name: string;
  caller_name: string | null;
  from_iso: string;
  to_iso: string;
  total_calls: number | null;
  successful_calls: number | null;
  failed_calls: number | null;
  total_trades: number | null;
  pnl_min: number | null;
  pnl_max: number | null;
  pnl_mean: number | null;
  pnl_median: number | null;
  created_at: string;
}

interface SimulationRunDetail extends SimulationRun {
  strategy_config: Record<string, unknown>;
}

interface SimulationEvent {
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
  indicators: unknown;
  positionState: unknown;
  metadata: unknown;
}

export async function getSimulationRuns(
  options?: {
    strategyName?: string;
    callerName?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }
): Promise<SimulationRun[]> {
  try {
    const dbPath = process.env.DUCKDB_PATH || 'data/result.duckdb';
    const client = getDuckDBClient(dbPath);
    const scriptPath = join(process.cwd(), 'tools/storage/duckdb_simulation_runs.py');

    const params: Record<string, unknown> = {
      limit: options?.limit || 50,
      offset: options?.offset || 0,
    };

    if (options?.strategyName) {
      params.strategy_name = options.strategyName;
    }
    if (options?.callerName) {
      params.caller_name = options.callerName;
    }
    if (options?.from) {
      params.from_iso = options.from;
    }
    if (options?.to) {
      params.to_iso = options.to;
    }

    const runs = await client.execute(scriptPath, 'list', params, SimulationRunsResponseSchema);
    return runs || [];
  } catch (error) {
    console.error('Error fetching simulation runs:', error);
    throw error;
  }
}

export async function getSimulationRun(runId: string): Promise<SimulationRunDetail> {
  try {
    const dbPath = process.env.DUCKDB_PATH || 'data/result.duckdb';
    const client = getDuckDBClient(dbPath);
    const scriptPath = join(process.cwd(), 'tools/storage/duckdb_simulation_runs.py');

    const RunDetailSchema = SimulationRunSchema.extend({
      strategy_config: z.record(z.string(), z.unknown()),
    });

    const run = await client.execute(
      scriptPath,
      'get',
      { run_id: runId },
      RunDetailSchema
    );

    if (!run || !Array.isArray(run) || run.length === 0) {
      throw new Error(`Simulation run ${runId} not found`);
    }

    return run[0] as SimulationRunDetail;
  } catch (error) {
    console.error('Error fetching simulation run:', error);
    throw error;
  }
}

export async function getSimulationEvents(
  runId: string,
  options?: {
    tokenAddress?: string;
    limit?: number;
  }
): Promise<SimulationEvent[]> {
  try {
    // Simulation events are stored in ClickHouse, not DuckDB
    // For now, we'll need to use the API route for events
    // TODO: Create a ClickHouse service for simulation events
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const params = new URLSearchParams();
    if (options?.tokenAddress) params.set('tokenAddress', options.tokenAddress);
    if (options?.limit) params.set('limit', options.limit.toString());

    const queryString = params.toString();
    const endpoint = `${baseUrl}/api/simulations/runs/${runId}/events${queryString ? `?${queryString}` : ''}`;
    
    const response = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch simulation events: ${response.statusText}`);
    }

    const result = await response.json();
    return result.events || [];
  } catch (error) {
    console.error('Error fetching simulation events:', error);
    throw error;
  }
}

export type { SimulationRun, SimulationRunDetail, SimulationEvent };
