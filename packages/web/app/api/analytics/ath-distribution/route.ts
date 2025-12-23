/**
 * ATH Distribution API Route
 * GET /api/analytics/ath-distribution - Get ATH distribution buckets
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAnalyticsEngine } from '@quantbot/analytics';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const callerName = searchParams.get('callerName');

    const engine = getAnalyticsEngine();
    const result = await engine.analyzeCalls({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      callerNames: callerName ? [callerName] : undefined,
      enrichWithAth: false,
    });

    return NextResponse.json({
      distribution: result.athDistribution,
    });
  } catch (error) {
    console.error('ATH Distribution API error:', error);
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

