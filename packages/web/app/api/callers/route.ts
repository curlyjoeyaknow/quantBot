/**
 * Callers API - PostgreSQL Version
 * Returns list of all unique callers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { callerService } from '@/lib/services/caller-service';
import { cache } from '@/lib/cache';
import { CONSTANTS } from '@/lib/constants';

const CALLERS_CACHE_KEY = 'callers:list';

const getCallersHandler = async (request: NextRequest) => {
  // Check cache first
  const cached = cache.get<string[]>(CALLERS_CACHE_KEY);
  if (cached) {
    return NextResponse.json({ data: cached });
  }

  const callers = await callerService.getAllCallers();

  // Cache for 1 hour
  cache.set(CALLERS_CACHE_KEY, callers, CONSTANTS.CACHE_TTL.OHLCV);

  return NextResponse.json({ data: callers });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getCallersHandler)
);

export const dynamic = 'force-dynamic';
