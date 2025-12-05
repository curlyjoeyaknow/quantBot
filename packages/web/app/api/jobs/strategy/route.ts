import { NextRequest, NextResponse } from 'next/server';
import { jobScheduler } from '@/lib/jobs/job-scheduler';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withValidation } from '@/lib/middleware/validation';
import { strategyJobSchema } from '@/lib/validation/schemas';

export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withValidation({ body: strategyJobSchema })(
      withRole([UserRole.ADMIN], async (request: NextRequest, session, validated) => {
        const { batchSize, maxAlerts } = validated.body!;

    if (jobScheduler.isStrategyJobRunning()) {
      return NextResponse.json(
        { error: 'Strategy job is already running', progress: jobScheduler.getStrategyJobProgress() },
        { status: 409 }
      );
    }

    // Run job asynchronously
    jobScheduler.runStrategyJob(batchSize, maxAlerts).catch(error => {
      console.error('Strategy job error:', error);
    });

        return NextResponse.json({
          message: 'Strategy computation job started',
          batchSize,
          maxAlerts,
        });
      })
    )
  )
);

const getStrategyJobStatusHandler = async (request: NextRequest) => {
  const progress = jobScheduler.getStrategyJobProgress();
  const isRunning = jobScheduler.isStrategyJobRunning();

  return NextResponse.json({
    isRunning,
    progress,
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getStrategyJobStatusHandler)
);

