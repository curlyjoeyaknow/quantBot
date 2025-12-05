/**
 * Token Distribution API
 * Returns token distribution by chain for pie charts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { analyticsService } from '@/lib/services/analytics-service';

const handler = async (request: NextRequest) => {
  const data = await analyticsService.getTokenDistribution();
  
  return NextResponse.json({ data });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

