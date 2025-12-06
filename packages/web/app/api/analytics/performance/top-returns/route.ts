/**
 * Top Callers by Returns API
 * Returns top callers ranked by return multiples (excluding bots)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { performanceAnalyticsService } from '@/lib/services/performance-analytics-service';

const handler = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10');

  const data = await performanceAnalyticsService.getTopCallersByReturns(limit);
  
  return NextResponse.json({ data });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

