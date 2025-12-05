/**
 * Price Distribution API
 * Returns price distribution histogram data
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { analyticsService } from '@/lib/services/analytics-service';

const handler = async (request: NextRequest) => {
  const data = await analyticsService.getPriceDistribution();
  
  return NextResponse.json({ data });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

