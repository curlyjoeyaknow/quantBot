/**
 * Dashboard Metrics API - PostgreSQL Version
 * Returns overview metrics for the main dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { dashboardServicePostgres } from '@/lib/services/dashboard-service-postgres';

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    async (request: NextRequest) => {
      const metrics = await dashboardServicePostgres.getMetrics();
      return NextResponse.json(metrics);
    }
  )
);

export const dynamic = 'force-dynamic';
export const revalidate = 0;
