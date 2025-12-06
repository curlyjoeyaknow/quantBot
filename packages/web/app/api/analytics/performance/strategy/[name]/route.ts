/**
 * Individual Strategy Analytics API
 * Detailed analytics for a specific trading strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { performanceAnalyticsService } from '@/lib/services/performance-analytics-service';

const handler = async (
  request: NextRequest,
  { params }: { params: { name: string } }
) => {
  const strategyName = decodeURIComponent(params.name);

  const data = await performanceAnalyticsService.getStrategyAnalytics(strategyName);
  
  if (!data.overview) {
    return NextResponse.json(
      { error: 'Strategy not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

