/**
 * Recent Alerts API - PostgreSQL Version
 * Returns alerts from the past 7 days with pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { callerService } from '@/lib/services/caller-service';
import { CONSTANTS } from '@/lib/constants';

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    async (request: NextRequest) => {
      const { searchParams } = new URL(request.url);
      
      // Validate and parse parameters
      const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
      const pageSize = Math.min(
        Math.max(1, parseInt(searchParams.get('pageSize') || CONSTANTS.FRONTEND.RECENT_ALERTS_PAGE_SIZE.toString()) || CONSTANTS.FRONTEND.RECENT_ALERTS_PAGE_SIZE),
        CONSTANTS.REQUEST.MAX_PAGE_SIZE
      );
      const daysBack = Math.min(Math.max(1, parseInt(searchParams.get('daysBack') || '7') || 7), 365);

      const result = await callerService.getRecentAlerts(page, pageSize, daysBack);
      
      return NextResponse.json({
        data: result.data,
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
        timestamp: new Date().toISOString()
      });
    }
  )
);

export const dynamic = 'force-dynamic';
export const revalidate = 0;
