/**
 * Lab Server - Self-contained Fastify UI
 *
 * Resource Model API:
 * - Backtest = execution request that creates Runs
 * - Run = immutable result record
 * - Leaderboard = view over runs (ranked)
 * - Strategies = stored configs/versions
 * - Statistics = aggregates
 */

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  LeaderboardRepository,
  RunStatusRepository,
  RunLogRepository,
  ArtifactRepository,
  openDuckDb,
} from '@quantbot/infra/storage';
import type { RunStatusInsertData } from '@quantbot/infra/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// Run ID generation
function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Cursor-based pagination helper
function encodeCursor(value: string | number): string {
  return Buffer.from(String(value)).toString('base64url');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf-8');
}

// Initialize repositories (lazy initialization)
let runStatusRepo: RunStatusRepository | null = null;
let runLogRepo: RunLogRepository | null = null;
let artifactRepo: ArtifactRepository | null = null;
let duckdbConnection: Awaited<ReturnType<typeof openDuckDb>> | null = null;

async function getRunStatusRepo(): Promise<RunStatusRepository> {
  if (!runStatusRepo) {
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    duckdbConnection = await openDuckDb(duckdbPath);
    runStatusRepo = new RunStatusRepository(duckdbConnection);
  }
  return runStatusRepo;
}

async function getRunLogRepo(): Promise<RunLogRepository> {
  if (!runLogRepo) {
    runLogRepo = new RunLogRepository();
    await runLogRepo.initializeSchema();
  }
  return runLogRepo;
}

function getArtifactRepo(): ArtifactRepository {
  if (!artifactRepo) {
    const baseDir = process.env.ARTIFACTS_DIR || './artifacts';
    artifactRepo = new ArtifactRepository(baseDir);
  }
  return artifactRepo;
}

async function logForRun(
  runId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  data?: unknown
): Promise<void> {
  try {
    const repo = await getRunLogRepo();
    await repo.insert({ runId, level, message, data });
  } catch (error) {
    // Log to console as fallback if database logging fails
    fastify.log.error({ runId, level, message, data, error }, 'Failed to log to database');
  }
}

// ============================================================================
// UI Routes
// ============================================================================

fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    let htmlPath = join(__dirname, 'ui', 'index.html');
    try {
      await readFile(htmlPath, 'utf-8');
    } catch {
      const srcPath = join(process.cwd(), 'packages', 'lab', 'src', 'ui', 'index.html');
      htmlPath = srcPath;
    }
    const html = await readFile(htmlPath, 'utf-8');
    reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.warn({ error }, 'UI file not found, serving fallback');
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>QuantBot Lab</title></head>
      <body>
        <h1>QuantBot Lab Server</h1>
        <p>UI file not found. Please build the package first.</p>
        <p><a href="/api/health">Health Check</a></p>
      </body>
      </html>
    `);
  }
});

// ============================================================================
// Backtest Endpoints
// ============================================================================

const BacktestRequestSchema = z.object({
  strategyId: z.string(),
  strategyVersion: z.string().optional().default('1'),
  universe: z.object({
    type: z.literal('tokens'),
    mints: z.array(z.string()),
  }),
  timeframe: z.string().default('5m'),
  range: z.object({
    start: z.string(), // ISO 8601
    end: z.string(), // ISO 8601
  }),
  seed: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// POST /backtest - Start a backtest
fastify.post('/backtest', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = BacktestRequestSchema.parse(request.body);
    const runId = generateRunId();

    // Store run status in database
    const statusRepo = await getRunStatusRepo();
    await statusRepo.upsert({
      runId,
      status: 'queued',
      strategyId: body.strategyId,
      strategyVersion: body.strategyVersion,
      config: body,
    });

    await logForRun(runId, 'info', 'Backtest queued', { strategyId: body.strategyId });

    // Start backtest asynchronously
    setImmediate(async () => {
      try {
        const statusRepo = await getRunStatusRepo();
        await statusRepo.updateStatus(runId, 'running');

        await logForRun(runId, 'info', 'Backtest started', { strategyId: body.strategyId });

        // Import workflows
        const { runSimulation, createProductionContext } = await import('@quantbot/workflows');
        const ctx = createProductionContext({
          // logHub is optional - omit if not available
        });

        // Convert backtest request to simulation spec
        const fromDate = DateTime.fromISO(body.range.start, { zone: 'utc' });
        const toDate = DateTime.fromISO(body.range.end, { zone: 'utc' });

        if (!fromDate.isValid || !toDate.isValid) {
          throw new Error(`Invalid date range: ${body.range.start} to ${body.range.end}`);
        }

        // For now, use first mint as caller (or extract caller from universe)
        // TODO: Support proper caller selection
        const callerName =
          body.universe.type === 'tokens' && body.universe.mints.length > 0
            ? undefined // Will query all callers for these mints
            : undefined;

        const spec = {
          strategyName: body.strategyId,
          callerName,
          from: fromDate,
          to: toDate,
          options: {
            dryRun: false,
            preWindowMinutes: 260, // Default
            postWindowMinutes: 1440, // Default
          },
        };

        await logForRun(runId, 'info', 'Running simulation workflow', { spec });

        // Run the simulation
        const result = await runSimulation(spec, ctx);

        await logForRun(runId, 'info', 'Simulation completed', {
          runId: result.runId,
          callsSucceeded: result.totals.callsSucceeded,
          trades: result.totals.tradesTotal,
        });

        // Update status with results
        await statusRepo.updateStatus(runId, 'completed', {
          runId: result.runId,
          callsFound: result.totals.callsFound,
          callsSucceeded: result.totals.callsSucceeded,
          callsFailed: result.totals.callsFailed,
          trades: result.totals.tradesTotal,
        });

        await logForRun(runId, 'info', 'Backtest completed successfully');
      } catch (error) {
        const statusRepo = await getRunStatusRepo();
        await statusRepo.updateStatus(
          runId,
          'failed',
          undefined,
          error instanceof Error ? error.message : String(error)
        );
        await logForRun(runId, 'error', 'Backtest failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        fastify.log.error({ runId, error }, 'Backtest execution failed');
      }
    });

    return { runId };
  } catch (error) {
    fastify.log.error(error);
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : 'Invalid backtest request',
    };
  }
});

// POST /backtest/dry-run - Validate and preview backtest
fastify.post('/backtest/dry-run', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = BacktestRequestSchema.parse(request.body);

    // Validate strategy exists
    const { StrategiesRepository } = await import('@quantbot/storage');
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const strategiesRepo = new StrategiesRepository(duckdbPath);
    const strategies = await strategiesRepo.list();
    const strategy = strategies.find(
      (s) => s.name === body.strategyId && s.version === body.strategyVersion
    );

    if (!strategy) {
      reply.code(404);
      return { error: `Strategy ${body.strategyId} v${body.strategyVersion} not found` };
    }

    // Estimate cost/time (stub for now)
    const estimatedCost = {
      computeUnits: 1000,
      estimatedTimeSeconds: 60,
    };

    // Resolved config
    const resolvedConfig = {
      ...body,
      strategy: strategy.config,
    };

    return {
      valid: true,
      estimatedCost,
      resolvedConfig,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(400);
    return {
      error: error instanceof Error ? error.message : 'Invalid dry-run request',
    };
  }
});

// ============================================================================
// Runs Endpoints
// ============================================================================

// GET /runs - List runs with cursor pagination
fastify.get('/runs', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as {
      status?: string;
      strategyId?: string;
      timeframe?: string;
      from?: string;
      to?: string;
      limit?: string;
      cursor?: string;
    };

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    // Query run_status table first (for lab API runs)
    const statusRepo = await getRunStatusRepo();
    const statusResult = await statusRepo.list({
      status: query.status as 'queued' | 'running' | 'completed' | 'failed' | undefined,
      strategyId: query.strategyId,
      limit,
      cursor: cursor || undefined,
    });

    // Map to API response format
    const runs = statusResult.runs.map((status) => ({
      runId: status.runId,
      strategyId: status.strategyId,
      status: status.status,
      summary: status.summary,
      createdAt: status.createdAt,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
    }));

    // If we need more results or no results from run_status, also query simulation_runs
    if (runs.length < limit) {
      const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
      const db = await openDuckDb(duckdbPath);

      let sql = `
        SELECT 
          run_id,
          strategy_id,
          mint,
          start_time,
          end_time,
          total_return_pct,
          max_drawdown_pct,
          sharpe_ratio,
          win_rate,
          total_trades,
          created_at
        FROM simulation_runs
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (query.strategyId) {
        sql += ` AND strategy_id LIKE ?`;
        params.push(`%${query.strategyId}%`);
      }

      if (cursor) {
        sql += ` AND created_at < ?`;
        params.push(cursor);
      }

      // Exclude runs already in run_status
      if (runs.length > 0) {
        const runIds = runs.map((r) => r.runId);
        sql += ` AND run_id NOT IN (${runIds.map(() => '?').join(',')})`;
        params.push(...runIds);
      }

      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit - runs.length + 1);

      const rows = await db.all<any>(sql, params as any[]);

      const legacyRuns = rows.map(
        (row: {
          run_id: string;
          strategy_id: string;
          total_return_pct: number | null;
          max_drawdown_pct: number | null;
          sharpe_ratio: number | null;
          win_rate: number | null;
          total_trades: number | null;
          created_at: string | null;
        }) => ({
          runId: row.run_id,
          strategyId: row.strategy_id,
          status: 'completed' as const,
          summary: {
            totalPnl: row.total_return_pct || 0,
            maxDrawdown: row.max_drawdown_pct || 0,
            sharpeRatio: row.sharpe_ratio || 0,
            winRate: row.win_rate || 0,
            trades: row.total_trades || 0,
          },
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
          startedAt: undefined,
          completedAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        })
      );

      runs.push(...legacyRuns);
    }

    const nextCursor = statusResult.nextCursor ? encodeCursor(statusResult.nextCursor) : null;

    return {
      runs,
      nextCursor,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch runs',
      runs: [],
      nextCursor: null,
    };
  }
});

// GET /runs/:runId - Get run details
fastify.get(
  '/runs/:runId',
  async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    try {
      const { runId } = request.params;

      // Get from run_status table first
      const statusRepo = await getRunStatusRepo();
      const status = await statusRepo.getById(runId);

      if (status) {
        return {
          runId: status.runId,
          status: status.status,
          config: status.config,
          summary: status.summary,
          error: status.error,
          createdAt: status.createdAt,
          startedAt: status.startedAt,
          completedAt: status.completedAt,
        };
      }

      // Fallback to simulation_runs table (for legacy runs)
      const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
      const db = await openDuckDb(duckdbPath);

      const rows = await db.all<any>(`SELECT * FROM simulation_runs WHERE run_id = ? LIMIT 1`, [
        runId,
      ]);

      if (rows.length === 0) {
        reply.code(404);
        return { error: `Run ${runId} not found` };
      }

      const row = rows[0]!;
      return {
        runId: row.run_id,
        status: 'completed' as const,
        strategyId: row.strategy_id,
        mint: row.mint,
        summary: {
          totalPnl: row.total_return_pct || 0,
          maxDrawdown: row.max_drawdown_pct || 0,
          sharpeRatio: row.sharpe_ratio || 0,
          winRate: row.win_rate || 0,
          trades: row.total_trades || 0,
        },
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch run',
      };
    }
  }
);

// GET /runs/:runId/logs - Get run logs
fastify.get(
  '/runs/:runId/logs',
  async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    try {
      const { runId } = request.params;
      const query = request.query as { limit?: string; cursor?: string };

      const limit = Math.min(parseInt(query.limit || '100', 10), 1000);
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;

      const logRepo = await getRunLogRepo();
      const result = await logRepo.getByRunId(runId, {
        limit,
        cursor: cursor || undefined,
      });

      return {
        logs: result.logs,
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
      };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch logs',
        logs: [],
        nextCursor: null,
      };
    }
  }
);

// GET /runs/:runId/artifacts - Get run artifacts
fastify.get(
  '/runs/:runId/artifacts',
  async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    try {
      const { runId } = request.params;

      const artifactRepo = getArtifactRepo();
      const artifacts = await artifactRepo.getByRunId(runId);

      return { artifacts };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch artifacts',
        artifacts: [],
      };
    }
  }
);

// GET /runs/:runId/metrics - Get run metrics
fastify.get(
  '/runs/:runId/metrics',
  async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    try {
      const { runId } = request.params;
      const query = request.query as { type?: string };

      // Query metrics from ClickHouse simulation_events
      // Note: ClickHouse uses numeric simulation_run_id, but we use string runId
      // For now, we'll query by run_id string if it exists in the events table
      const { getClickHouseClient } = await import('@quantbot/storage');
      const ch = getClickHouseClient();
      const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      try {
        // Query drawdown (cumulative PnL over time)
        const drawdownQuery = `
          SELECT 
            toUnixTimestamp(event_time) as timestamp,
            pnl_so_far as pnl
          FROM ${database}.simulation_events
          WHERE run_id = {runId:String}
          ORDER BY timestamp ASC
        `;

        // Query exposure (position size over time)
        const exposureQuery = `
          SELECT 
            toUnixTimestamp(event_time) as timestamp,
            remaining_position as exposure
          FROM ${database}.simulation_events
          WHERE run_id = {runId:String}
          ORDER BY timestamp ASC
        `;

        // Query fills (trade events)
        const fillsQuery = `
          SELECT 
            toUnixTimestamp(event_time) as timestamp,
            event_type,
            price,
            size,
            pnl_so_far as pnl
          FROM ${database}.simulation_events
          WHERE run_id = {runId:String} AND event_type IN ('entry', 'exit')
          ORDER BY timestamp ASC
        `;

        // Try to query (may fail if table doesn't exist or runId not found)
        const [drawdownResult, exposureResult, fillsResult] = await Promise.allSettled([
          ch.query({
            query: drawdownQuery,
            query_params: { runId },
            format: 'JSONEachRow',
          }),
          ch.query({
            query: exposureQuery,
            query_params: { runId },
            format: 'JSONEachRow',
          }),
          ch.query({
            query: fillsQuery,
            query_params: { runId },
            format: 'JSONEachRow',
          }),
        ]);

        const drawdown =
          drawdownResult.status === 'fulfilled'
            ? ((await drawdownResult.value.json()) as Array<{ timestamp: number; pnl: number }>)
            : [];
        const exposure =
          exposureResult.status === 'fulfilled'
            ? ((await exposureResult.value.json()) as Array<{
                timestamp: number;
                exposure: number;
              }>)
            : [];
        const fills =
          fillsResult.status === 'fulfilled'
            ? ((await fillsResult.value.json()) as Array<{
                timestamp: number;
                event_type: string;
                price: number;
                size: number;
                pnl: number;
              }>)
            : [];

        return {
          metrics: {
            drawdown,
            exposure,
            fills,
          },
        };
      } catch (error) {
        // If query fails (table doesn't exist, etc.), return empty metrics
        fastify.log.warn({ runId, error }, 'Failed to query metrics from ClickHouse');
        return {
          metrics: {
            drawdown: [],
            exposure: [],
            fills: [],
          },
        };
      }
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch metrics',
        metrics: {},
      };
    }
  }
);

// ============================================================================
// Leaderboard Endpoints
// ============================================================================

// GET /leaderboard - Ranked view over runs
fastify.get('/leaderboard', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as {
      metric?: string;
      timeframe?: string;
      strategyId?: string;
      window?: string;
      limit?: string;
    };

    const metric = query.metric || 'pnl';
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);

    const repo = new LeaderboardRepository();

    let entries;
    if (metric === 'stability') {
      entries = await repo.getTopByStability(limit);
    } else if (metric === 'pareto') {
      entries = await repo.getParetoFrontier();
      entries = entries.slice(0, limit);
    } else {
      entries = await repo.getTopByPnl(limit);
    }

    // Filter by strategy if provided
    if (query.strategyId) {
      entries = entries.filter((entry: any) => {
        const name = entry.presetName || entry.strategyId || '';
        return name.includes(query.strategyId!);
      });
    }

    const transformed = entries.map((entry: any) => ({
      strategyId: entry.strategyId,
      strategyName: entry.presetName || entry.strategyId,
      pnl: entry.metrics.totalPnlPercent || 0,
      stability: entry.stabilityScore?.score || 0,
      trades: entry.metrics.totalTrades || 0,
      winRate: entry.metrics.winRate || 0,
      maxDrawdown: entry.metrics.maxDrawdownPercent || 0,
    }));

    return { entries: transformed };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch leaderboard',
      entries: [],
    };
  }
});

// GET /leaderboard/strategies - Strategy-level leaderboard
fastify.get('/leaderboard/strategies', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // TODO: Aggregate runs per strategy
    // For now, return empty
    return { strategies: [] };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch strategy leaderboard',
      strategies: [],
    };
  }
});

// ============================================================================
// Strategies Endpoints
// ============================================================================

// GET /strategies - List strategies
fastify.get('/strategies', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { StrategiesRepository } = await import('@quantbot/storage');
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const repo = new StrategiesRepository(duckdbPath);

    const strategies = await repo.list();
    return { strategies };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch strategies',
      strategies: [],
    };
  }
});

// GET /strategies/:id - Get strategy details
fastify.get(
  '/strategies/:id',
  async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const query = request.query as { version?: string };
      const version = query.version || '1';

      const { StrategiesRepository } = await import('@quantbot/storage');
      const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
      const repo = new StrategiesRepository(duckdbPath);

      const strategies = await repo.list();
      const strategy = strategies.find((s) => s.name === id && s.version === version);

      if (!strategy) {
        reply.code(404);
        return { error: `Strategy ${id} v${version} not found` };
      }

      return { strategy };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to fetch strategy',
      };
    }
  }
);

// POST /strategies - Create new strategy version
fastify.post('/strategies', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // TODO: Implement strategy creation
    reply.code(501);
    return { error: 'Not implemented yet' };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to create strategy',
    };
  }
});

// PATCH /strategies/:id - Update strategy metadata
fastify.patch(
  '/strategies/:id',
  async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      // TODO: Implement strategy metadata update
      reply.code(501);
      return { error: 'Not implemented yet' };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to update strategy',
      };
    }
  }
);

// POST /strategies/:id/validate - Validate strategy config
fastify.post(
  '/strategies/:id/validate',
  async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      // TODO: Validate strategy config schema
      return { valid: true };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        error: error instanceof Error ? error.message : 'Failed to validate strategy',
      };
    }
  }
);

// ============================================================================
// Statistics Endpoints
// ============================================================================

// GET /statistics/overview - Overview statistics
fastify.get('/statistics/overview', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const db = await openDuckDb(duckdbPath);

    // Query run_status table
    const statusStats = await db.all<{ count: number }>(`SELECT COUNT(*) as count FROM run_status`);
    const totalRunsFromStatus = statusStats[0]?.count || 0;

    // Query simulation_runs table
    const runStats = await db.all<{
      total_runs: number;
      total_tokens: number;
      avg_pnl: number;
      win_rate: number;
    }>(`
      SELECT 
        COUNT(*) as total_runs,
        COUNT(DISTINCT mint) as total_tokens,
        AVG(total_return_pct) as avg_pnl,
        AVG(CASE WHEN total_return_pct > 0 THEN 1.0 ELSE 0.0 END) as win_rate
      FROM simulation_runs
      WHERE total_return_pct IS NOT NULL
    `);

    const stats = runStats[0] || {
      total_runs: 0,
      total_tokens: 0,
      avg_pnl: 0,
      win_rate: 0,
    };

    return {
      totalRuns: totalRunsFromStatus + stats.total_runs,
      totalTokens: stats.total_tokens,
      avgPnl: stats.avg_pnl || 0,
      winRate: stats.win_rate || 0,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch overview statistics',
    };
  }
});

// GET /statistics/pnl - PnL statistics
fastify.get('/statistics/pnl', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as {
      groupBy?: string;
      from?: string;
      to?: string;
      timeframe?: string;
    };

    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const db = await openDuckDb(duckdbPath);
    const groupBy = query.groupBy || 'day';
    let groupByClause = 'DATE(created_at)';
    if (groupBy === 'week') {
      groupByClause = "DATE_TRUNC('week', created_at)";
    } else if (groupBy === 'month') {
      groupByClause = "DATE_TRUNC('month', created_at)";
    } else if (groupBy === 'strategy') {
      groupByClause = 'strategy_id';
    } else if (groupBy === 'token') {
      groupByClause = 'mint';
    } else if (groupBy === 'caller') {
      groupByClause = 'caller_name';
    }

    let sql = `
      SELECT 
        ${groupByClause} as period,
        COUNT(*) as run_count,
        AVG(total_return_pct) as avg_pnl,
        SUM(total_return_pct) as total_pnl,
        MIN(total_return_pct) as min_pnl,
        MAX(total_return_pct) as max_pnl
      FROM simulation_runs
      WHERE total_return_pct IS NOT NULL
    `;

    const params: unknown[] = [];

    if (query.from) {
      sql += ' AND created_at >= ?';
      params.push(query.from);
    }

    if (query.to) {
      sql += ' AND created_at <= ?';
      params.push(query.to);
    }

    sql += ` GROUP BY ${groupByClause} ORDER BY period DESC LIMIT 100`;

    const rows = await db.all<{
      period: string;
      run_count: number;
      avg_pnl: number;
      total_pnl: number;
      min_pnl: number;
      max_pnl: number;
    }>(sql, params);

    return {
      pnl: rows.map(
        (row: {
          period: string;
          run_count: number;
          avg_pnl: number;
          total_pnl: number;
          min_pnl: number;
          max_pnl: number;
        }) => ({
          period: String(row.period),
          runCount: row.run_count,
          avgPnl: row.avg_pnl || 0,
          totalPnl: row.total_pnl || 0,
          minPnl: row.min_pnl || 0,
          maxPnl: row.max_pnl || 0,
        })
      ),
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch PnL statistics',
    };
  }
});

// GET /statistics/distribution - Distribution statistics
fastify.get('/statistics/distribution', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const db = await openDuckDb(duckdbPath);
    // Create PnL distribution histogram (buckets)
    const pnlHistogram = await db.all<{ bucket: string; count: number }>(`
      SELECT 
        CASE
          WHEN total_return_pct < -50 THEN '<-50%'
          WHEN total_return_pct < -25 THEN '-50% to -25%'
          WHEN total_return_pct < -10 THEN '-25% to -10%'
          WHEN total_return_pct < 0 THEN '-10% to 0%'
          WHEN total_return_pct < 10 THEN '0% to 10%'
          WHEN total_return_pct < 25 THEN '10% to 25%'
          WHEN total_return_pct < 50 THEN '25% to 50%'
          WHEN total_return_pct < 100 THEN '50% to 100%'
          ELSE '>100%'
        END as bucket,
        COUNT(*) as count
      FROM simulation_runs
      WHERE total_return_pct IS NOT NULL
      GROUP BY bucket
      ORDER BY MIN(total_return_pct)
    `);

    // Create trades distribution
    const tradesHistogram = await db.all<{ bucket: string; count: number }>(`
      SELECT 
        CASE
          WHEN total_trades = 0 THEN '0'
          WHEN total_trades < 5 THEN '1-4'
          WHEN total_trades < 10 THEN '5-9'
          WHEN total_trades < 20 THEN '10-19'
          WHEN total_trades < 50 THEN '20-49'
          ELSE '50+'
        END as bucket,
        COUNT(*) as count
      FROM simulation_runs
      WHERE total_trades IS NOT NULL
      GROUP BY bucket
      ORDER BY MIN(total_trades)
    `);

    return {
      distributions: {
        pnl: pnlHistogram.map((row: { bucket: string; count: number }) => ({
          bucket: row.bucket,
          count: row.count,
        })),
        trades: tradesHistogram.map((row: { bucket: string; count: number }) => ({
          bucket: row.bucket,
          count: row.count,
        })),
      },
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch distribution statistics',
    };
  }
});

// GET /statistics/correlation - Correlation statistics
fastify.get('/statistics/correlation', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const db = await openDuckDb(duckdbPath);
    // Calculate correlations between metrics
    const correlations = await db.all<{
      metric1: string;
      metric2: string;
      correlation: number;
    }>(`
      SELECT 
        'total_return_pct' as metric1,
        'total_trades' as metric2,
        CORR(total_return_pct, total_trades) as correlation
      FROM simulation_runs
      WHERE total_return_pct IS NOT NULL AND total_trades IS NOT NULL
      
      UNION ALL
      
      SELECT 
        'total_return_pct' as metric1,
        'win_rate' as metric2,
        CORR(total_return_pct, win_rate) as correlation
      FROM simulation_runs
      WHERE total_return_pct IS NOT NULL AND win_rate IS NOT NULL
      
      UNION ALL
      
      SELECT 
        'total_trades' as metric1,
        'win_rate' as metric2,
        CORR(total_trades, win_rate) as correlation
      FROM simulation_runs
      WHERE total_trades IS NOT NULL AND win_rate IS NOT NULL
    `);

    return {
      correlations: correlations.map(
        (row: { metric1: string; metric2: string; correlation: number }) => ({
          metric1: row.metric1,
          metric2: row.metric2,
          correlation: row.correlation || 0,
        })
      ),
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch correlation statistics',
    };
  }
});

// ============================================================================
// Health & Legacy Endpoints
// ============================================================================

// GET /api/health - Health check
fastify.get('/api/health', async () => {
  return { status: 'ok', service: 'lab' };
});

// Legacy endpoints (for backward compatibility with existing UI)
fastify.get('/api/leaderboard', async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as { sort?: string; limit?: string };
  const metric =
    query.sort === 'stability' ? 'stability' : query.sort === 'pareto' ? 'pareto' : 'pnl';
  const limit = query.limit || '50';

  const response = await fastify.inject({
    method: 'GET',
    url: `/leaderboard?metric=${metric}&limit=${limit}`,
  });

  reply.code(response.statusCode).send(response.json());
});

fastify.get('/api/strategies', async (request: FastifyRequest, reply: FastifyReply) => {
  const response = await fastify.inject({
    method: 'GET',
    url: '/strategies',
  });

  reply.code(response.statusCode).send(response.json());
});

fastify.get('/api/simulation-runs', async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as { limit?: string; strategy?: string };
  const limit = query.limit || '50';
  const strategyId = query.strategy;

  const url = `/runs?limit=${limit}${strategyId ? `&strategyId=${encodeURIComponent(strategyId)}` : ''}`;
  const response = await fastify.inject({
    method: 'GET',
    url,
  });

  reply.code(response.statusCode).send(response.json());
});

// ============================================================================
// Server Startup
// ============================================================================

export async function startServer(port: number = 3001) {
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Lab server running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('server')) {
  const port = parseInt(process.env.PORT || '3001', 10);
  startServer(port).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
