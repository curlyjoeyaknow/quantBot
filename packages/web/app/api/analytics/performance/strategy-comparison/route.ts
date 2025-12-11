/**
 * Strategy Performance Comparison API
 * Compares effectiveness of different trading strategies
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { performanceAnalyticsService } from '@/lib/services/performance-analytics-service';

const handler = async (request: NextRequest) => {
  const data = await performanceAnalyticsService.getStrategyPerformance();
  
  return NextResponse.json({ data });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(withErrorHandling(handler));
export const dynamic = 'force-dynamic';

