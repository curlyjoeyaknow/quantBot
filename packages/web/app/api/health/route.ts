/**
 * Health Check API - PostgreSQL Version
 * Provides system health status and database statistics
 */

import { NextResponse } from 'next/server';
import { postgresManager } from '@/lib/db/postgres-manager';

export async function GET() {
  try {
    // Check PostgreSQL connection
    const healthy = await postgresManager.healthCheck();
    
    if (!healthy) {
      return NextResponse.json({
        status: 'unhealthy',
        database: 'postgresql',
        error: 'Database connection failed',
        timestamp: new Date().toISOString()
      }, { status: 503 });
    }

    // Get database statistics
    const statsResult = await postgresManager.query(`
      SELECT 
        (SELECT COUNT(*) FROM alerts) as total_alerts,
        (SELECT COUNT(*) FROM tokens) as total_tokens,
        (SELECT COUNT(*) FROM callers) as total_callers,
        (SELECT COUNT(*) FROM strategies) as total_strategies,
        (SELECT COUNT(*) FROM simulation_runs) as total_simulations,
        (SELECT COUNT(*) FROM dashboard_metrics) as total_metrics,
        (SELECT pg_size_pretty(pg_database_size(current_database()))) as database_size,
        (SELECT version()) as pg_version
    `);

    const stats = statsResult.rows[0];

    return NextResponse.json({
      status: 'healthy',
      database: 'postgresql',
      connection: 'active',
      stats: {
        alerts: parseInt(stats.total_alerts),
        tokens: parseInt(stats.total_tokens),
        callers: parseInt(stats.total_callers),
        strategies: parseInt(stats.total_strategies),
        simulations: parseInt(stats.total_simulations),
        metrics: parseInt(stats.total_metrics),
        databaseSize: stats.database_size,
      },
      version: {
        postgres: stats.pg_version.split(',')[0]
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json({
      status: 'unhealthy',
      database: 'postgresql',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
