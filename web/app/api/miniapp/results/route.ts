/**
 * Mini App Results API
 * ===================
 * Returns simulation results for the Mini App.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';

export const GET = withErrorHandling(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('userId');
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  if (!userId) {
    return NextResponse.json(
      { error: { message: 'userId is required' } },
      { status: 400 }
    );
  }

  try {
    // TODO: Fetch from database
    // const results = await getUserSimulationRuns(parseInt(userId, 10), limit);

    // For now, return empty array
    return NextResponse.json({
      data: [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: { message: error.message || 'Failed to fetch results' } },
      { status: 500 }
    );
  }
});

