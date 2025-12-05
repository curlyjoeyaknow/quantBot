import { NextRequest, NextResponse } from 'next/server';
import { jobScheduler } from '@/lib/jobs/job-scheduler';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withRole([UserRole.ADMIN], async (request: NextRequest, session) => {
    // Run dashboard computation synchronously (it's fast)
    const metrics = await jobScheduler.runDashboardJob();

      return NextResponse.json({
        message: 'Dashboard computation completed',
        metrics,
      });
    })
  )
);

