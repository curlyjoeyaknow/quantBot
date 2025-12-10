/**
 * Strategy Management API
 * 
 * RESTful API for strategy CRUD operations with validation and stats.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  saveStrategy,
  getUserStrategies,
  getStrategy,
  deleteStrategy,
} from '../../utils/database';
import {
  StrategyLegSchema,
  StopLossConfigSchema,
  EntryConfigSchema,
  ReEntryConfigSchema,
  CostConfigSchema,
} from '../../simulation/config';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'simulations.db');

// Validation schemas
const CreateStrategySchema = z.object({
  userId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  strategy: z.array(StrategyLegSchema).nonempty(),
  stopLossConfig: StopLossConfigSchema,
  entryConfig: EntryConfigSchema.optional(),
  reEntryConfig: ReEntryConfigSchema.optional(),
  costConfig: CostConfigSchema.optional(),
  isDefault: z.boolean().optional().default(false),
});

const UpdateStrategySchema = CreateStrategySchema.partial().extend({
  userId: z.number().int().positive(),
  name: z.string().min(1).max(100),
});

/**
 * GET /api/strategies - List user's strategies with stats
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId query parameter is required' },
        { status: 400 }
      );
    }

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
    }

    const strategies = await getUserStrategies(userIdNum);

    // Get stats for each strategy
    const strategiesWithStats = await Promise.all(
      strategies.map(async (strategy) => {
        const stats = await getStrategyStats(strategy.id);
        return {
          ...strategy,
          stats,
        };
      })
    );

    return NextResponse.json({ strategies: strategiesWithStats });
  } catch (error: any) {
    logger.error('Error fetching strategies', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch strategies' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/strategies - Create new strategy
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreateStrategySchema.parse(body);

    // Check if strategy with same name already exists
    const existing = await getStrategy(validated.userId, validated.name);
    if (existing) {
      return NextResponse.json(
        { error: 'Strategy with this name already exists' },
        { status: 409 }
      );
    }

    const strategyId = await saveStrategy({
      userId: validated.userId,
      name: validated.name,
      description: validated.description,
      strategy: validated.strategy,
      stopLossConfig: validated.stopLossConfig,
      isDefault: validated.isDefault,
    });

    return NextResponse.json(
      {
        id: strategyId,
        message: 'Strategy created successfully',
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Error creating strategy', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to create strategy' },
      { status: 500 }
    );
  }
}

/**
 * Get strategy statistics from simulation_runs
 */
async function getStrategyStats(strategyId: number): Promise<{
  totalRuns: number;
  successfulRuns: number;
  averagePnl: number;
  totalPnl: number;
  winRate: number;
  lastRunAt?: string;
}> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }

      // Get strategy name first
      db.get(
        'SELECT name FROM strategies WHERE id = ?',
        [strategyId],
        (err, strategyRow: any) => {
          if (err || !strategyRow) {
            db.close();
            return resolve({
              totalRuns: 0,
              successfulRuns: 0,
              averagePnl: 0,
              totalPnl: 0,
              winRate: 0,
            });
          }

          const strategyName = strategyRow.name;

          // Get stats from simulation_runs
          db.get(
            `SELECT 
              COUNT(*) as total_runs,
              SUM(CASE WHEN final_pnl > 0 THEN 1 ELSE 0 END) as successful_runs,
              AVG(final_pnl) as avg_pnl,
              SUM(final_pnl) as total_pnl,
              MAX(created_at) as last_run_at
            FROM simulation_runs
            WHERE strategy_name = ?`,
            [strategyName],
            (err, row: any) => {
              db.close();
              if (err) {
                return reject(err);
              }

              const totalRuns = row?.total_runs || 0;
              const successfulRuns = row?.successful_runs || 0;
              const averagePnl = row?.avg_pnl || 0;
              const totalPnl = row?.total_pnl || 0;
              const winRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

              resolve({
                totalRuns,
                successfulRuns,
                averagePnl,
                totalPnl,
                winRate,
                lastRunAt: row?.last_run_at || undefined,
              });
            }
          );
        }
      );
    });
  });
}

