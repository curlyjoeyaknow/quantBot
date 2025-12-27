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
import { LeaderboardRepository } from '@quantbot/storage';
import { getClickHouseClient } from '@quantbot/storage';

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

// Run status tracking (in-memory for now, should be in DB)
const runStatuses = new Map<
  string,
  {
    status: 'queued' | 'running' | 'completed' | 'failed';
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    config?: unknown;
    summary?: unknown;
    error?: string;
  }
>();

// Run-scoped logging (in-memory for now)
const runLogs = new Map<
  string,
  Array<{ timestamp: string; level: string; message: string; data?: unknown }>
>();

function logForRun(runId: string, level: string, message: string, data?: unknown): void {
  if (!runLogs.has(runId)) {
    runLogs.set(runId, []);
  }
  const logs = runLogs.get(runId)!;
  logs.push({
    timestamp: DateTime.utc().toISO()!,
    level,
    message,
    data,
  });
  // Keep last 1000 logs per run
  if (logs.length > 1000) {
    logs.shift();
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

    // Store run status
    runStatuses.set(runId, {
      status: 'queued',
      createdAt: DateTime.utc().toISO()!,
      config: body,
    });

    logForRun(runId, 'info', 'Backtest queued', { strategyId: body.strategyId });

    // Start backtest asynchronously
    setImmediate(async () => {
      try {
        const status = runStatuses.get(runId);
        if (!status) return;

        runStatuses.set(runId, {
          ...status,
          status: 'running',
          startedAt: DateTime.utc().toISO()!,
        });

        logForRun(runId, 'info', 'Backtest started', { strategyId: body.strategyId });

        // Import workflows
        const { runSimulation, createProductionContext } = await import('@quantbot/workflows');
        const ctx = createProductionContext({
          logHub: {
            hub: logHub,
            scope: 'simulation',
            runId,
            requestId,
          },
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

        logForRun(runId, 'info', 'Running simulation workflow', { spec });

        // Run the simulation
        const result = await runSimulation(spec, ctx);

        logForRun(runId, 'info', 'Simulation completed', {
          runId: result.runId,
          callsSucceeded: result.totals.callsSucceeded,
          trades: result.totals.tradesTotal,
        });

        // Update status with results
        runStatuses.set(runId, {
          ...status,
          status: 'completed',
          completedAt: DateTime.utc().toISO()!,
          summary: {
            runId: result.runId,
            callsFound: result.totals.callsFound,
            callsSucceeded: result.totals.callsSucceeded,
            callsFailed: result.totals.callsFailed,
            trades: result.totals.tradesTotal,
          },
        });

        logForRun(runId, 'info', 'Backtest completed successfully');
      } catch (error) {
        const status = runStatuses.get(runId);
        if (status) {
          runStatuses.set(runId, {
            ...status,
            status: 'failed',
            completedAt: DateTime.utc().toISO()!,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        logForRun(runId, 'error', 'Backtest failed', {
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

    // Query DuckDB simulation_runs
    const { openDuckDb } = await import('@quantbot/storage');
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const db = await openDuckDb(duckdbPath);

    let sql = `
      SELECT 
        run_id,
        strategy_id,
        mint,
        alert_timestamp,
        start_time,
        end_time,
        caller_name,
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

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit + 1); // Fetch one extra to check if there's more

    const rows = await db.all<any>(sql, params as any[]);

    const hasMore = rows.length > limit;
    const runs = (hasMore ? rows.slice(0, limit) : rows).map((row: any) => ({
      runId: row.run_id,
      strategyId: row.strategy_id,
      mint: row.mint,
      status: 'completed' as const,
      timeframe: '5m',
      range: {
        start: row.start_time ? new Date(row.start_time).toISOString() : null,
        end: row.end_time ? new Date(row.end_time).toISOString() : null,
      },
      summary: {
        totalPnl: row.total_return_pct || 0,
        maxDrawdown: row.max_drawdown_pct || 0,
        sharpeRatio: row.sharpe_ratio || 0,
        winRate: row.win_rate || 0,
        trades: row.total_trades || 0,
      },
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));

    const nextCursor =
      hasMore && runs.length > 0 ? encodeCursor(runs[runs.length - 1]!.createdAt || '') : null;

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

      // Check in-memory status first
      const status = runStatuses.get(runId);
      if (status) {
        return {
          runId,
          status: status.status,
          config: status.config,
          summary: status.summary,
          error: status.error,
          createdAt: status.createdAt,
          startedAt: status.startedAt,
          completedAt: status.completedAt,
        };
      }

      // Fallback to DuckDB
      const { openDuckDb } = await import('@quantbot/storage');
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

      const logs = runLogs.get(runId) || [];

      // Simple cursor pagination (by timestamp)
      let filteredLogs = logs;
      if (cursor) {
        const cursorIndex = logs.findIndex((log) => log.timestamp === cursor);
        if (cursorIndex >= 0) {
          filteredLogs = logs.slice(cursorIndex + 1);
        }
      }

      const paginatedLogs = filteredLogs.slice(0, limit);
      const nextCursor =
        filteredLogs.length > limit
          ? encodeCursor(paginatedLogs[paginatedLogs.length - 1]!.timestamp)
          : null;

      return {
        logs: paginatedLogs,
        nextCursor,
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

      // TODO: Query actual artifacts from storage
      // For now, return stub
      return {
        artifacts: [
          {
            type: 'parquet',
            path: `/artifacts/${runId}/events.parquet`,
            size: 0,
          },
          {
            type: 'csv',
            path: `/artifacts/${runId}/summary.csv`,
            size: 0,
          },
        ],
      };
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

      // TODO: Query actual metrics from ClickHouse/events
      // For now, return stub
      return {
        metrics: {
          drawdown: [],
          exposure: [],
          fills: [],
        },
      };
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
    const { openDuckDb } = await import('@quantbot/storage');
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    const db = await openDuckDb(duckdbPath);

    const stats = await db.all<any>(`
      SELECT 
        COUNT(*) as total_runs,
        COUNT(DISTINCT strategy_id) as unique_strategies,
        COUNT(DISTINCT mint) as unique_tokens,
        AVG(total_return_pct) as avg_pnl,
        AVG(win_rate) as avg_win_rate
      FROM simulation_runs
    `);

    return {
      totals: stats[0] || {
        total_runs: 0,
        unique_strategies: 0,
        unique_tokens: 0,
        avg_pnl: 0,
        avg_win_rate: 0,
      },
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
    // TODO: Implement grouped PnL statistics
    return { pnl: [] };
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
    // TODO: Implement distribution histograms
    return { distributions: {} };
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
    // TODO: Implement feature correlations
    return { correlations: {} };
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
