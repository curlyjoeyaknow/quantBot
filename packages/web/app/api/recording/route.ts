import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { dbManager } from '@/lib/db-manager';
import { getClickHouseClient } from '@/lib/clickhouse';
import { withAuth } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

const getRecordingHandler = async (request: NextRequest) => {
    const db = await dbManager.getDatabase();
    const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;
    const get = promisify(db.get.bind(db)) as (query: string, params?: any[]) => Promise<any>;

    // Get database stats from caller_alerts
    const statsResult = await all(`
      SELECT 
        COUNT(*) as total_alerts,
        COUNT(DISTINCT caller_name) as total_callers,
        COUNT(DISTINCT token_address) as total_tokens,
        MIN(alert_timestamp) as earliest_alert,
        MAX(alert_timestamp) as latest_alert
      FROM caller_alerts
    `) as any[];

    const stats = statsResult[0] || {
      total_alerts: 0,
      total_callers: 0,
      total_tokens: 0,
      earliest_alert: null,
      latest_alert: null,
    };

    // Get total ticks from ClickHouse
    let totalTicks = 0;
    let recordingActive = false;
    let lastTickTime: string | null = null;

    try {
      const ch = getClickHouseClient();
      const tickResult = await ch.query({
        query: `
          SELECT 
            count() as total_ticks,
            max(timestamp) as last_tick
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        `,
        format: 'JSONEachRow',
      });

      const tickData = await tickResult.json() as Array<{ total_ticks: number; last_tick: string }>;
      if (tickData && tickData.length > 0) {
        totalTicks = tickData[0].total_ticks || 0;
        lastTickTime = tickData[0].last_tick || null;
        
        // Check if recording is active (last tick within last 10 minutes)
        if (lastTickTime) {
          const lastTick = new Date(lastTickTime);
          const now = new Date();
          const minutesSinceLastTick = (now.getTime() - lastTick.getTime()) / 1000 / 60;
          recordingActive = minutesSinceLastTick < 10;
        }
      }
    } catch (error: any) {
      console.error('Error querying ClickHouse for ticks:', error.message);
      // ClickHouse might not be available, that's okay
    }

    // Check if there are recent alerts (within last hour) as another indicator
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentAlertsResult = await get(
      `SELECT COUNT(*) as count FROM caller_alerts WHERE alert_timestamp >= ?`,
      [oneHourAgo]
    ) as { count: number };

    const recentAlerts = recentAlertsResult?.count || 0;
    if (recentAlerts > 0 && !recordingActive) {
      // If we have recent alerts but no recent ticks, recording might be active for alerts
      recordingActive = true;
    }

    return NextResponse.json({
      recording: {
        active: recordingActive,
        lastTickTime,
      },
      database: {
        totalAlerts: stats.total_alerts,
        totalCallers: stats.total_callers,
        totalTokens: stats.total_tokens,
        earliestAlert: stats.earliest_alert,
        latestAlert: stats.latest_alert,
        recentAlerts,
      },
      clickhouse: {
        totalTicks,
        lastTickTime,
      },
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getRecordingHandler)
);

