import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { dbManager } from '@/lib/db-manager';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

const getCallerStatsHandler = async (request: NextRequest) => {
  const db = await dbManager.getDatabase();
  const all = promisify(db.all.bind(db));

  // Get caller statistics
  const callerStats = await all(`
    SELECT 
      caller_name,
      COUNT(*) as total_calls,
      COUNT(DISTINCT token_address) as unique_tokens,
      MIN(alert_timestamp) as first_call,
      MAX(alert_timestamp) as last_call,
      AVG(price_at_alert) as avg_price
    FROM caller_alerts
    GROUP BY caller_name
    ORDER BY total_calls DESC
  `) as any[];

  // Get total stats
  const totalStats = await all(`
    SELECT 
      COUNT(*) as total_calls,
      COUNT(DISTINCT caller_name) as total_callers,
      COUNT(DISTINCT token_address) as total_tokens,
      MIN(alert_timestamp) as earliest_call,
      MAX(alert_timestamp) as latest_call
    FROM caller_alerts
  `) as any[];

  return NextResponse.json({
    callers: callerStats.map(stat => ({
      name: stat.caller_name,
      totalCalls: stat.total_calls,
      uniqueTokens: stat.unique_tokens,
      firstCall: stat.first_call,
      lastCall: stat.last_call,
      avgPrice: stat.avg_price ? parseFloat(stat.avg_price) : null,
    })),
    totals: totalStats[0] || {
      total_calls: 0,
      total_callers: 0,
      total_tokens: 0,
      earliest_call: null,
      latest_call: null,
    },
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getCallerStatsHandler)
);

