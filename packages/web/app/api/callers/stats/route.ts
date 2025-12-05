/**
 * Caller Stats API - PostgreSQL Version
 * Returns statistics for all callers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { callerService } from '@/lib/services/caller-service';
import { cache, cacheKeys } from '@/lib/cache';
import { CONSTANTS } from '@/lib/constants';

const getCallerStatsHandler = async (request: NextRequest) => {
  // Check cache first
  const cacheKey = cacheKeys.callerStats();
  const cached = cache.get<any[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ data: cached });
  }

  const stats = await callerService.getCallerStats();

  // Cache for 30 minutes
  cache.set(cacheKey, stats, CONSTANTS.CACHE_TTL.CALLER_STATS);

  return NextResponse.json({ data: stats });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getCallerStatsHandler)
);

export const dynamic = 'force-dynamic';
