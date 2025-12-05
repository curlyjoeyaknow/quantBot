import { NextRequest, NextResponse } from 'next/server';
import { jobScheduler } from '@/lib/jobs/job-scheduler';
import { dashboardMetricsDb } from '@/lib/jobs/dashboard-metrics-db';
import { strategyResultsDb } from '@/lib/jobs/strategy-results-db';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

const getJobsStatusHandler = async (request: NextRequest) => {
    const strategyProgress = jobScheduler.getStrategyJobProgress();
    const isStrategyRunning = jobScheduler.isStrategyJobRunning();
    
    // Get latest dashboard metrics timestamp
    const latestMetrics = await dashboardMetricsDb.getLatestMetrics();
    const metricsAge = latestMetrics 
      ? Math.round((Date.now() - new Date(latestMetrics.computed_at).getTime()) / 1000 / 60) // minutes
      : null;

    // Get strategy results count
    const strategyDb = await strategyResultsDb.getDatabase();
    const { promisify } = await import('util');
    const get = promisify(strategyDb.get.bind(strategyDb));
    const strategyCountResult = await get('SELECT COUNT(*) as count FROM strategy_results') as { count: number };
    const strategyResultsCount = strategyCountResult?.count || 0;

    // Check if scheduler is enabled
    const schedulerEnabled = process.env.NODE_ENV === 'production' || process.env.ENABLE_BACKGROUND_JOBS === 'true';

    return NextResponse.json({
      schedulerEnabled,
      strategyJob: {
        isRunning: isStrategyRunning,
        progress: strategyProgress,
        totalComputed: strategyResultsCount,
      },
      dashboardMetrics: {
        lastComputed: latestMetrics?.computed_at || null,
        ageMinutes: metricsAge,
        available: latestMetrics !== null,
      },
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getJobsStatusHandler)
);

