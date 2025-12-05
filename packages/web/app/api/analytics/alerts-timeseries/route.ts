/**
 * Alerts Time Series API
 * Returns alert counts over time for charts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { analyticsService } from '@/lib/services/analytics-service';

const handler = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30');

  const data = await analyticsService.getAlertsTimeSeries(days);
  
  return NextResponse.json({
    data,
    metadata: {
      days,
      totalPoints: data.length,
    },
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

