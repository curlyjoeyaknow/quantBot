import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { simulationService } from '@/lib/services/simulation-service';

const getSimulationByNameHandler = async (
  request: NextRequest,
  context: { params: Promise<{ name: string }> | { name: string } }
) => {
  // Handle both sync and async params (Next.js 15+ uses Promise)
  const params = 'then' in context.params ? await context.params : context.params;
  
  try {
    const { summary, tradeHistory } = await simulationService.getSimulationByName(params.name);
    return NextResponse.json({
      summary,
      tradeHistory,
    });
  } catch (error: any) {
    if (error.message === 'Simulation not found') {
      return NextResponse.json(
        { error: 'Simulation not found' },
        { status: 404 }
      );
    }
    if (error.message === 'Invalid simulation name' || error.message === 'Invalid simulation path') {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    throw error;
  }
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> | { name: string } }
) {
  return rateLimit(RATE_LIMITS.STANDARD)(
    withErrorHandling(() => getSimulationByNameHandler(request, context))
  )(request);
}

