/**
 * Simulation Details API - PostgreSQL Version
 * Returns detailed information about a specific simulation
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { simulationService } from '@/lib/services/simulation-service';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  const params = await context.params;
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
}

export const dynamic = 'force-dynamic';
