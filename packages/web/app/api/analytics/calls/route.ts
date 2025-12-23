/**
 * Call Performance API Route
 * GET /api/analytics/calls - Get call performance data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAnalyticsEngine } from '@quantbot/analytics';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const callerName = searchParams.get('callerName');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    const engine = getAnalyticsEngine();
    const result = await engine.analyzeCalls({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      callerNames: callerName ? [callerName] : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      enrichWithAth: false,
    });

    // Apply pagination
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const paginatedCalls = result.calls.slice(offsetNum, offsetNum + limitNum);

    // Serialize Date objects
    const calls = paginatedCalls.map((call) => ({
      ...call,
      alertTimestamp: call.alertTimestamp.toISOString(),
      atlTimestamp: call.atlTimestamp?.toISOString(),
    }));

    return NextResponse.json({
      calls,
      total: result.calls.length,
      metadata: {
        processingTimeMs: result.metadata.processingTimeMs,
      },
    });
  } catch (error) {
    console.error('Calls API error:', error);
    return NextResponse.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}

