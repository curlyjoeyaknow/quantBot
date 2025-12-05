import { NextRequest, NextResponse } from 'next/server';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { performanceTracker } from '@/lib/middleware/performance';
import { cache } from '@/lib/cache';

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    withRole([UserRole.ADMIN], async (request: NextRequest, session) => {
      const stats = performanceTracker.getStats();
      const cacheStats = cache.getStats();

      return NextResponse.json({
        performance: stats,
        cache: cacheStats,
        timestamp: new Date().toISOString(),
      });
    })
  )
);

