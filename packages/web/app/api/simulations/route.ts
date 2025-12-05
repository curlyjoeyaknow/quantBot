import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { simulationService } from '@/lib/services/simulation-service';

const getSimulationsHandler = async (request: NextRequest) => {
  const simulations = await simulationService.listSimulations();
  return NextResponse.json({ data: simulations });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getSimulationsHandler)
);

