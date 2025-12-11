/**
 * Caller Stats API - PostgreSQL Version
 * Returns statistics for all callers in CallerStatsData format
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { callerService } from '@/lib/services/caller-service';

const getCallerStatsHandler = async (request: NextRequest) => {
  // Service handles caching internally
  const stats = await callerService.getCallerStatsFormatted();

  return NextResponse.json(stats);
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getCallerStatsHandler)
);

export const dynamic = 'force-dynamic';
export const revalidate = 0;
