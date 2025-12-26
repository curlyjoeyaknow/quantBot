/**
 * Lab Server - Self-contained Fastify UI
 *
 * Provides a simple web UI for the lab package without depending on Next.js/web package.
 */

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { LeaderboardRepository } from '@quantbot/storage';
import { getClickHouseClient } from '@quantbot/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// Serve static HTML
fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // Try dist/ui/index.html first (production), then src/ui/index.html (development)
    let htmlPath = join(__dirname, 'ui', 'index.html');
    try {
      await readFile(htmlPath, 'utf-8');
    } catch {
      // Fallback to source directory
      const srcPath = join(process.cwd(), 'packages', 'lab', 'src', 'ui', 'index.html');
      htmlPath = srcPath;
    }
    const html = await readFile(htmlPath, 'utf-8');
    reply.type('text/html').send(html);
  } catch (error) {
    fastify.log.warn({ error }, 'UI file not found, serving fallback');
    // Fallback: serve inline HTML if file not found
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>QuantBot Lab</title></head>
      <body>
        <h1>QuantBot Lab Server</h1>
        <p>UI file not found. Please build the package first.</p>
        <p><a href="/api/health">Health Check</a></p>
        <p><a href="/api/leaderboard">Leaderboard API</a></p>
      </body>
      </html>
    `);
  }
});

// API: Get leaderboard
fastify.get('/api/leaderboard', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as { sort?: string; limit?: string };
    const sort = query.sort || 'pnl';
    const limit = parseInt(query.limit || '50', 10);

    const clickhouse = getClickHouseClient();
    const repo = new LeaderboardRepository();

    // Get leaderboard entries based on sort type
    let entries;
    if (sort === 'stability') {
      entries = await repo.getTopByStability(limit);
    } else if (sort === 'pareto') {
      entries = await repo.getParetoFrontier();
      // Limit results
      entries = entries.slice(0, limit);
    } else {
      // Default: sort by PnL
      entries = await repo.getTopByPnl(limit);
    }

    // Transform entries to match UI expectations
    const transformed = entries.map((entry: any) => ({
      strategyName: entry.presetName || entry.strategyId,
      strategyId: entry.strategyId,
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

// API: Get strategies
// NOTE: Direct repository instantiation is acceptable here because:
// 1. This is a standalone server (composition root)
// 2. Lab server is infrastructure, not application logic
// 3. It's the boundary between HTTP and domain
fastify.get('/api/strategies', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { StrategiesRepository } = await import('@quantbot/storage');
    const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
    // Direct instantiation in composition root (server) is acceptable
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

// API: Get simulation runs
fastify.get('/api/simulation-runs', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as { limit?: string; strategy?: string };
    const limit = parseInt(query.limit || '50', 10);

    // TODO: Implement simulation runs query from storage
    // For now, return empty array
    return { runs: [] };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch simulation runs',
      runs: [],
    };
  }
});

// API: Get feature sets
fastify.get('/api/feature-sets', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // TODO: Implement feature sets query from catalog/storage
    // For now, return empty array
    return { featureSets: [] };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch feature sets',
      featureSets: [],
    };
  }
});

// API: Get optimization jobs
fastify.get('/api/optimization-jobs', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // TODO: Implement optimization jobs query from storage
    // For now, return empty array
    return { jobs: [] };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch optimization jobs',
      jobs: [],
    };
  }
});

// API: Get catalog/slices
fastify.get('/api/slices', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = request.query as { limit?: string };
    const limit = parseInt(query.limit || '50', 10);

    // TODO: Implement slices query from catalog
    // For now, return empty array
    return { slices: [] };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch slices',
      slices: [],
    };
  }
});

// API: Health check
fastify.get('/api/health', async () => {
  return { status: 'ok', service: 'lab' };
});

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
