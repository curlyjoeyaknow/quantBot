import { NextRequest, NextResponse } from 'next/server';
import { sanitizeString } from '@/lib/validation';
import { CONSTANTS } from '@/lib/constants';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withValidation } from '@/lib/middleware/validation';
import { callerHistoryQuerySchema } from '@/lib/validation/schemas';
import { callerAlertService } from '@/lib/services/caller-alert-service';
import { paginatedResponse } from '@/lib/response/standard-response';

const getCallerHistoryHandler = async (request: NextRequest, validated: any) => {
  const query = validated.query!;
  const caller = query.caller ? sanitizeString(query.caller) : undefined;
  const { startDate, endDate, minMarketCap, maxMarketCap, minMaxGain, maxMaxGain, isDuplicate, page, pageSize } = query;

  const result = await callerAlertService.getCallerHistory(
    {
      caller,
      startDate,
      endDate,
      minMarketCap,
      maxMarketCap,
      minMaxGain,
      maxMaxGain,
      isDuplicate,
    },
    page,
    pageSize
  );

  // Return standardized paginated response
  return paginatedResponse(
    result.data,
    page,
    pageSize,
    result.total,
    request,
    200,
    result.meta
  );
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    withValidation({ query: callerHistoryQuerySchema })(getCallerHistoryHandler)
  )
);
