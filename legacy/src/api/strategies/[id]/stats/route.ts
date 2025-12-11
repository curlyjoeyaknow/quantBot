/**
 * Strategy Statistics API
 * 
 * GET /api/strategies/:id/stats - Get detailed performance statistics for a strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '../../../utils/logger';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'simulations.db');

/**
 * GET /api/strategies/:id/stats - Get strategy performance statistics
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

    const stats = await getDetailedStrategyStats(id, userIdNum);

    return NextResponse.json(stats);
  } catch (error: any) {
    logger.error('Error fetching strategy stats', error as Error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch strategy stats' },
      { status: 500 }
    );
  }
}

/**
 * Get detailed strategy statistics
 */
async function getDetailedStrategyStats(
  strategyId: number,
  userId: number
): Promise<{
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averagePnl: number;
  totalPnl: number;
  winRate: number;
  maxPnl: number;
  minPnl: number;
  averageCandles: number;
  lastRunAt?: string;
  firstRunAt?: string;
  pnlDistribution: {
    positive: number;
    negative: number;
    zero: number;
  };
}> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }

      // Get strategy name
      db.get(
        'SELECT name FROM strategies WHERE id = ? AND user_id = ?',
        [strategyId, userId],
        (err, strategyRow: any) => {
          if (err) {
            db.close();
            return reject(err);
          }

          if (!strategyRow) {
            db.close();
            return reject(new Error('Strategy not found'));
          }

          const strategyName = strategyRow.name;

          // Get detailed stats
          db.get(
            `SELECT 
              COUNT(*) as total_runs,
              SUM(CASE WHEN final_pnl > 0 THEN 1 ELSE 0 END) as successful_runs,
              SUM(CASE WHEN final_pnl <= 0 THEN 1 ELSE 0 END) as failed_runs,
              AVG(final_pnl) as avg_pnl,
              SUM(final_pnl) as total_pnl,
              MAX(final_pnl) as max_pnl,
              MIN(final_pnl) as min_pnl,
              AVG(total_candles) as avg_candles,
              MAX(created_at) as last_run_at,
              MIN(created_at) as first_run_at,
              SUM(CASE WHEN final_pnl > 0 THEN 1 ELSE 0 END) as positive_pnl,
              SUM(CASE WHEN final_pnl < 0 THEN 1 ELSE 0 END) as negative_pnl,
              SUM(CASE WHEN final_pnl = 0 THEN 1 ELSE 0 END) as zero_pnl
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
              const failedRuns = row?.failed_runs || 0;
              const averagePnl = row?.avg_pnl || 0;
              const totalPnl = row?.total_pnl || 0;
              const winRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

              resolve({
                totalRuns,
                successfulRuns,
                failedRuns,
                averagePnl,
                totalPnl,
                winRate,
                maxPnl: row?.max_pnl || 0,
                minPnl: row?.min_pnl || 0,
                averageCandles: row?.avg_candles || 0,
                lastRunAt: row?.last_run_at || undefined,
                firstRunAt: row?.first_run_at || undefined,
                pnlDistribution: {
                  positive: row?.positive_pnl || 0,
                  negative: row?.negative_pnl || 0,
                  zero: row?.zero_pnl || 0,
                },
              });
            }
          );
        }
      );
    });
  });
}

