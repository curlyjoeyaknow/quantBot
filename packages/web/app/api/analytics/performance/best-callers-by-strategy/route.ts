/**
 * Best Callers by Strategy API
 * Returns top performing callers for a specific strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { performanceAnalyticsService } from '@/lib/services/performance-analytics-service';

const handler = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const strategy = searchParams.get('strategy');
  const limit = parseInt(searchParams.get('limit') || '10');

  if (!strategy) {
    return NextResponse.json(
      { error: 'Strategy parameter is required' },
      { status: 400 }
    );
  }

  const data = await performanceAnalyticsService.getBestCallersByStrategy(
    strategy,
    limit
  );
  
  return NextResponse.json({ data });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

