import { NextResponse } from 'next/server';
import '@/lib/jobs/init-scheduler'; // Ensure scheduler is initialized
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

// Health endpoint is public (no auth required) but rate limited
export const GET = rateLimit(RATE_LIMITS.LENIENT)(async () => {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    backgroundJobsEnabled: process.env.ENABLE_BACKGROUND_JOBS === 'true' || process.env.NODE_ENV === 'production',
  });
});

