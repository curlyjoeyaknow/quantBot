import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { dashboardService } from '@/lib/services/dashboard-service';

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    async (request: NextRequest) => {
      const metrics = await dashboardService.getMetrics();
      return NextResponse.json(metrics);
    }
  )
);
