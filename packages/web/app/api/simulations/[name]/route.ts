/**
 * Simulation Details API - PostgreSQL Version
 * Returns detailed information about a specific simulation
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { simulationService } from '@/lib/services/simulation-service';

const getSimulationDetailsHandler = async (
  request: NextRequest,
  { params }: { params: { name: string } }
) => {
  const simulationId = parseInt(params.name);

  if (isNaN(simulationId)) {
    return NextResponse.json(
      { error: 'Invalid simulation ID' },
      { status: 400 }
    );
  }

  const simulation = await simulationService.getSimulationDetails(simulationId);

  if (!simulation) {
    return NextResponse.json(
      { error: 'Simulation not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(simulation);
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getSimulationDetailsHandler)
);

export const dynamic = 'force-dynamic';
