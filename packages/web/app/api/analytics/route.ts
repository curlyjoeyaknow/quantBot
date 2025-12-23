/**
 * Analytics API Route
 * GET /api/analytics - Get dashboard summary
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

    const engine = getAnalyticsEngine();
    const result = await engine.analyzeCalls({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      callerNames: callerName ? [callerName] : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      enrichWithAth: false, // Use pre-calculated values
    });

    // Convert Date objects to ISO strings for JSON serialization
    const serializedResult = {
      ...result,
      calls: result.calls.map((call) => ({
        ...call,
        alertTimestamp: call.alertTimestamp.toISOString(),
        atlTimestamp: call.atlTimestamp?.toISOString(),
      })),
      callerMetrics: result.callerMetrics.map((metric) => ({
        ...metric,
        firstCall: metric.firstCall.toISOString(),
        lastCall: metric.lastCall.toISOString(),
      })),
      dashboard: {
        ...result.dashboard,
        generatedAt: result.dashboard.generatedAt.toISOString(),
        recentCalls: result.dashboard.recentCalls.map((call) => ({
          ...call,
          alertTimestamp: call.alertTimestamp.toISOString(),
          atlTimestamp: call.atlTimestamp?.toISOString(),
        })),
      },
    };

    return NextResponse.json(serializedResult);
  } catch (error) {
    console.error('Analytics API error:', error);
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

