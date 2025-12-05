/**
 * Simulations API - PostgreSQL Version
 * Returns list of simulation runs
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { simulationService } from '@/lib/services/simulation-service';

const getSimulationsHandler = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');
  const status = searchParams.get('status') || undefined;
  const strategyId = searchParams.get('strategyId') 
    ? parseInt(searchParams.get('strategyId')!) 
    : undefined;

  const result = await simulationService.listSimulations({
    limit,
    offset,
    status,
    strategyId,
  });

  return NextResponse.json({
    data: result.simulations,
    total: result.total,
    page: Math.floor(offset / limit) + 1,
    pageSize: limit,
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getSimulationsHandler)
);

export const dynamic = 'force-dynamic';
