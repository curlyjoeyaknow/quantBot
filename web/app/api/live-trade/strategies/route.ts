import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import { withAuth } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withValidation } from '@/lib/middleware/validation';
import { liveTradeStrategyUpdateSchema, liveTradeStrategiesBatchUpdateSchema } from '@/lib/validation/schemas';

const DB_PATH = path.join(process.cwd(), '..', 'simulations.db');

// Pre-defined strategies
const PREDEFINED_STRATEGIES = [
  {
    id: 'initial_entry',
    name: 'Initial Entry (Price Drop)',
    description: 'Wait for price to drop a specified percentage from alert price before entering',
    category: 'entry' as const,
    defaultEnabled: true,
  },
  {
    id: 'trailing_entry',
    name: 'Trailing Entry (Rebound)',
    description: 'Wait for price to rebound from lowest point before entering',
    category: 'entry' as const,
    defaultEnabled: true,
  },
  {
    id: 'ichimoku_tenkan_kijun',
    name: 'Ichimoku Tenkan/Kijun Cross',
    description: 'Enter when Tenkan line crosses above Kijun line (bullish momentum)',
    category: 'indicator' as const,
    defaultEnabled: true,
  },
  {
    id: 'ichimoku_cloud_cross',
    name: 'Ichimoku Cloud Cross',
    description: 'Enter when price crosses above the Ichimoku cloud (trend change)',
    category: 'indicator' as const,
    defaultEnabled: false,
  },
  {
    id: 'ichimoku_cloud_exit',
    name: 'Ichimoku Cloud Exit',
    description: 'Enter when price exits the Ichimoku cloud upward (bullish breakout)',
    category: 'indicator' as const,
    defaultEnabled: false,
  },
];

/**
 * Initialize strategy configuration table
 */
async function initStrategyTable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const run = promisify(db.run.bind(db)) as (sql: string, params?: any[]) => Promise<any>;

    run(`
      CREATE TABLE IF NOT EXISTS live_trade_strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
      .then(() => {
        // Insert default strategies if they don't exist
        const insertPromises = PREDEFINED_STRATEGIES.map((strategy) =>
          run(
            `INSERT OR IGNORE INTO live_trade_strategies (id, name, description, category, enabled)
             VALUES (?, ?, ?, ?, ?)`,
            [
              strategy.id,
              strategy.name,
              strategy.description,
              strategy.category,
              strategy.defaultEnabled ? 1 : 0,
            ]
          )
        );
        return Promise.all(insertPromises);
      })
      .then(() => {
        db.close();
        resolve();
      })
      .catch((err) => {
        db.close();
        reject(err);
      });
  });
}

/**
 * GET - Get all strategies with their enabled/disabled status
 */
const getStrategiesHandler = async (request: NextRequest) => {
  await initStrategyTable();

  const db = new sqlite3.Database(DB_PATH);
  const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;

  const strategies = await all(
    `SELECT id, name, description, category, enabled 
     FROM live_trade_strategies 
     ORDER BY category, name`
  );

  db.close();

  return NextResponse.json({
    strategies: strategies.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      enabled: s.enabled === 1,
    })),
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getStrategiesHandler)
);

/**
 * PUT - Update strategy enabled/disabled status
 */
export const PUT = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withValidation({ body: liveTradeStrategyUpdateSchema })(
      withAuth(async (request: NextRequest, session, validated) => {
        await initStrategyTable();

        const { strategyId, enabled } = validated.body!;

        const db = new sqlite3.Database(DB_PATH);
        const run = promisify(db.run.bind(db)) as (query: string, params?: any[]) => Promise<any>;

        await run(
          `UPDATE live_trade_strategies 
           SET enabled = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [enabled ? 1 : 0, strategyId]
        );

        db.close();

        return NextResponse.json({ success: true });
      })
    )
  )
);

/**
 * POST - Update multiple strategies at once
 */
export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withValidation({ body: liveTradeStrategiesBatchUpdateSchema })(
      withAuth(async (request: NextRequest, session, validated) => {
        await initStrategyTable();

        const { strategies } = validated.body!;

        const db = new sqlite3.Database(DB_PATH);
        const run = promisify(db.run.bind(db)) as (query: string, params?: any[]) => Promise<any>;

        // Update all strategies in a transaction
        for (const strategy of strategies) {
          if (strategy.id && typeof strategy.enabled === 'boolean') {
            await run(
              `UPDATE live_trade_strategies 
               SET enabled = ?, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [strategy.enabled ? 1 : 0, strategy.id]
            );
          }
        }

        db.close();

        return NextResponse.json({ success: true });
      })
    )
  )
);

