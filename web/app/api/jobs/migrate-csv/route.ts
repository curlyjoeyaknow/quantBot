import { NextRequest, NextResponse } from 'next/server';
import { migrateAllCSVResults } from '@/lib/jobs/migrate-csv-to-sqlite';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withRole([UserRole.ADMIN], async (request: NextRequest, session) => {
    // Run migration asynchronously (it might take a while)
    migrateAllCSVResults().catch(error => {
      console.error('CSV migration error:', error);
    });

      return NextResponse.json({
        message: 'CSV migration started',
        note: 'Migration is running in the background. Check /api/jobs/status for progress.',
      });
    })
  )
);

