/**
 * Strategy Detail API
 * 
 * GET, PUT, DELETE operations for individual strategies.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getStrategy,
  saveStrategy,
  deleteStrategy,
} from '../../../utils/database';
import {
  StrategyLegSchema,
  StopLossConfigSchema,
  EntryConfigSchema,
  ReEntryConfigSchema,
  CostConfigSchema,
} from '../../../simulation/config';
import { z } from 'zod';
import { logger } from '../../../utils/logger';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'simulations.db');

const UpdateStrategySchema = z.object({
  userId: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  strategy: z.array(StrategyLegSchema).nonempty().optional(),
  stopLossConfig: StopLossConfigSchema.optional(),
  entryConfig: EntryConfigSchema.optional(),
  reEntryConfig: ReEntryConfigSchema.optional(),
  costConfig: CostConfigSchema.optional(),
  isDefault: z.boolean().optional(),
});

/**
 * GET /api/strategies/:id - Get strategy details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid strategy ID' }, { status: 400 });
    }

    // Get userId from query params
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

    // Get strategy from database by ID
    const strategy = await getStrategyById(id, userIdNum);

    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }

    // Get stats
    const stats = await getStrategyStats(id);

    return NextResponse.json({
      ...strategy,
      stats,
    });
  } catch (error: any) {
    logger.error('Error fetching strategy', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch strategy' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/strategies/:id - Update strategy
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid strategy ID' }, { status: 400 });
    }

    const body = await request.json();
    const validated = UpdateStrategySchema.parse(body);

    // Get existing strategy
    const existing = await getStrategyById(id, validated.userId);
    if (!existing) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }

    // Merge with existing data
    const updated = {
      userId: validated.userId,
      name: validated.name || existing.name,
      description: validated.description !== undefined ? validated.description : existing.description,
      strategy: validated.strategy || existing.strategy,
      stopLossConfig: validated.stopLossConfig || existing.stopLossConfig,
      isDefault: validated.isDefault !== undefined ? validated.isDefault : existing.isDefault,
    };

    // Update strategy
    await saveStrategy(updated);

    return NextResponse.json({
      message: 'Strategy updated successfully',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Error updating strategy', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to update strategy' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/strategies/:id - Delete strategy
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid strategy ID' }, { status: 400 });
    }

    // Get userId from query params
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

    // Get strategy name first
    const strategy = await getStrategyById(id, userIdNum);
    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }

    await deleteStrategy(userIdNum, strategy.name);

    return NextResponse.json({
      message: 'Strategy deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting strategy', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete strategy' },
      { status: 500 }
    );
  }
}

/**
 * Get strategy by ID
 */
async function getStrategyById(
  id: number,
  userId: number
): Promise<any | null> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }

      db.get(
        'SELECT * FROM strategies WHERE id = ? AND user_id = ?',
        [id, userId],
        (err, row: any) => {
          db.close();
          if (err) {
            return reject(err);
          }
          if (!row) {
            return resolve(null);
          }

          resolve({
            id: row.id,
            userId: row.user_id,
            name: row.name,
            description: row.description,
            strategy: JSON.parse(row.strategy),
            stopLossConfig: JSON.parse(row.stop_loss_config),
            isDefault: row.is_default === 1,
            createdAt: row.created_at,
          });
        }
      );
    });
  });
}

/**
 * Get strategy statistics
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

