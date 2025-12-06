/**
 * Caller History API - PostgreSQL Version
 * Returns paginated caller history with filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { sanitizeString } from '@/lib/validation';
import { CONSTANTS } from '@/lib/constants';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { callerService } from '@/lib/services/caller-service';

const getCallerHistoryHandler = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  
  // Parse query parameters
  const caller = searchParams.get('caller') ? sanitizeString(searchParams.get('caller')!) : undefined;
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const minMarketCap = searchParams.get('minMarketCap') ? parseFloat(searchParams.get('minMarketCap')!) : undefined;
  const maxMarketCap = searchParams.get('maxMarketCap') ? parseFloat(searchParams.get('maxMarketCap')!) : undefined;
  const minMaxGain = searchParams.get('minMaxGain') ? parseFloat(searchParams.get('minMaxGain')!) : undefined;
  const maxMaxGain = searchParams.get('maxMaxGain') ? parseFloat(searchParams.get('maxMaxGain')!) : undefined;
  const isDuplicateParam = searchParams.get('isDuplicate');
  const isDuplicate = isDuplicateParam === 'true' ? true : isDuplicateParam === 'false' ? false : undefined;
  const search = searchParams.get('search') ? sanitizeString(searchParams.get('search')!) : undefined;
  
  // Validate and parse pagination parameters
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(
    Math.max(1, parseInt(searchParams.get('pageSize') || CONSTANTS.FRONTEND.DEFAULT_PAGE_SIZE.toString()) || CONSTANTS.FRONTEND.DEFAULT_PAGE_SIZE),
    CONSTANTS.REQUEST.MAX_PAGE_SIZE
  );

  const result = await callerService.getCallerHistory(
    {
      caller,
      startDate,
      endDate,
      minMarketCap,
      maxMarketCap,
      minMaxGain,
      maxMaxGain,
      isDuplicate,
      search,
    },
    page,
    pageSize
  );

  return NextResponse.json({
    data: result.data,
    total: result.total,
    page,
    pageSize,
    totalPages: Math.ceil(result.total / pageSize),
    timestamp: new Date().toISOString(),
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getCallerHistoryHandler)
);

export const dynamic = 'force-dynamic';
export const revalidate = 0;
