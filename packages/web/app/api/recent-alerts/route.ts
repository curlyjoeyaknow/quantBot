/**
 * Recent Alerts API - PostgreSQL Version
 * Returns alerts from the past 7 days
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { callerService } from '@/lib/services/caller-service';

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    async (request: NextRequest) => {
      const { searchParams } = new URL(request.url);
      const limit = parseInt(searchParams.get('limit') || '100');

      const alerts = await callerService.getRecentAlerts(limit);
      
      return NextResponse.json({
        alerts,
        count: alerts.length,
        timestamp: new Date().toISOString()
      });
    }
  )
);

export const dynamic = 'force-dynamic';
export const revalidate = 0;
