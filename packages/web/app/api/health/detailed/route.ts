import { NextRequest, NextResponse } from 'next/server';
import { dbManager } from '@/lib/db-manager';
import { healthCheck as clickhouseHealthCheck, getClickHouseClient } from '@/lib/clickhouse';
import { promisify } from 'util';
import { strategyResultsDb } from '@/lib/jobs/strategy-results-db';
import { dashboardMetricsDb } from '@/lib/jobs/dashboard-metrics-db';
import { jobScheduler } from '@/lib/jobs/job-scheduler';
import { withAuth } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

interface ServiceStatus {
  name: string;
  status: 'online' | 'offline' | 'degraded';
  lastCheck: string;
  details?: any;
}

const getHealthDetailedHandler = async (request: NextRequest) => {
      const services: ServiceStatus[] = [];
      const now = new Date().toISOString();

  // 1. SQLite Caller Alerts Database
  try {
    const db = await dbManager.getDatabase();
    const get = promisify(db.get.bind(db));
    const result = await get('SELECT COUNT(*) as count FROM caller_alerts') as { count: number };
    services.push({
      name: 'SQLite Caller Alerts DB',
      status: 'online',
      lastCheck: now,
      details: {
        totalAlerts: result?.count || 0,
      },
    });
  } catch (error: any) {
    services.push({
      name: 'SQLite Caller Alerts DB',
      status: 'offline',
      lastCheck: now,
      details: { error: error.message },
    });
  }

  // 2. Strategy Results Database
  try {
    const strategyDb = await strategyResultsDb.getDatabase();
    const get = promisify(strategyDb.get.bind(strategyDb));
    const result = await get('SELECT COUNT(*) as count FROM strategy_results') as { count: number };
    services.push({
      name: 'Strategy Results DB',
      status: 'online',
      lastCheck: now,
      details: {
        totalResults: result?.count || 0,
      },
    });
  } catch (error: any) {
    services.push({
      name: 'Strategy Results DB',
      status: 'offline',
      lastCheck: now,
      details: { error: error.message },
    });
  }

  // 3. Dashboard Metrics Database
  try {
    const latestMetrics = await dashboardMetricsDb.getLatestMetrics();
    services.push({
      name: 'Dashboard Metrics DB',
      status: latestMetrics ? 'online' : 'degraded',
      lastCheck: now,
      details: {
        hasMetrics: !!latestMetrics,
        lastComputed: latestMetrics?.computed_at || null,
      },
    });
  } catch (error: any) {
    services.push({
      name: 'Dashboard Metrics DB',
      status: 'offline',
      lastCheck: now,
      details: { error: error.message },
    });
  }

  // 4. ClickHouse
  try {
    const isHealthy = await clickhouseHealthCheck();
    if (isHealthy) {
      const ch = getClickHouseClient();
      const tickResult = await ch.query({
        query: `SELECT count() as total FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles`,
        format: 'JSONEachRow',
      });
      const tickData = await tickResult.json() as Array<{ total: number }>;
      const totalTicks = tickData?.[0]?.total || 0;

      services.push({
        name: 'ClickHouse',
        status: 'online',
        lastCheck: now,
        details: {
          totalTicks,
        },
      });
    } else {
      services.push({
        name: 'ClickHouse',
        status: 'offline',
        lastCheck: now,
        details: { error: 'Health check failed' },
      });
    }
  } catch (error: any) {
    services.push({
      name: 'ClickHouse',
      status: 'offline',
      lastCheck: now,
      details: { error: error.message },
    });
  }

  // 5. Background Job Scheduler
  try {
    const schedulerEnabled = process.env.NODE_ENV === 'production' || process.env.ENABLE_BACKGROUND_JOBS === 'true';
    const strategyProgress = jobScheduler.getStrategyJobProgress();
    const isStrategyRunning = jobScheduler.isStrategyJobRunning();
    const latestMetrics = await dashboardMetricsDb.getLatestMetrics();

    services.push({
      name: 'Background Jobs',
      status: schedulerEnabled ? 'online' : 'degraded',
      lastCheck: now,
      details: {
        enabled: schedulerEnabled,
        strategyJobRunning: isStrategyRunning,
        strategyProgress: strategyProgress,
        lastDashboardCompute: latestMetrics?.computed_at || null,
      },
    });
  } catch (error: any) {
    services.push({
      name: 'Background Jobs',
      status: 'offline',
      lastCheck: now,
      details: { error: error.message },
    });
  }

  // 6. Recent Activity
  let recentActivity: any[] = [];
  try {
    const db = await dbManager.getDatabase();
    const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;
    
    // Get recent alerts (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentAlerts = await all(
      `SELECT caller_name, COUNT(*) as count, MAX(alert_timestamp) as latest
       FROM caller_alerts
       WHERE alert_timestamp >= ?
       GROUP BY caller_name
       ORDER BY latest DESC
       LIMIT 10`,
      [oneDayAgo]
    ) as any[];

    recentActivity = recentAlerts.map(alert => ({
      type: 'alert',
      caller: alert.caller_name,
      count: alert.count,
      timestamp: alert.latest,
    }));
  } catch (error: any) {
    // Ignore
  }

  // Get recent strategy computations
  try {
    const strategyDb = await strategyResultsDb.getDatabase();
    const strategyAll = promisify(strategyDb.all.bind(strategyDb)) as (query: string, params?: any[]) => Promise<any[]>;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentComputations = await strategyAll(
      `SELECT COUNT(*) as count, MAX(computed_at) as latest
       FROM strategy_results
       WHERE computed_at >= ?`,
      [oneDayAgo]
    ) as any[];

    if (recentComputations?.[0]?.count > 0) {
      recentActivity.push({
        type: 'strategy_computation',
        count: recentComputations[0].count,
        timestamp: recentComputations[0].latest,
      });
    }
  } catch (error: any) {
    // Ignore
  }

  // Calculate overall health
  const onlineCount = services.filter(s => s.status === 'online').length;
  const totalCount = services.length;
  const overallHealth = onlineCount === totalCount ? 'healthy' : 
                       onlineCount >= totalCount * 0.7 ? 'degraded' : 'unhealthy';

  return NextResponse.json({
    overallHealth,
    services,
    recentActivity: recentActivity.sort((a, b) => 
      new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    ).slice(0, 10),
    timestamp: now,
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getHealthDetailedHandler)
);

