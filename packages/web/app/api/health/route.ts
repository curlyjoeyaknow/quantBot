/**
 * Health Check API Route
 * GET /api/health - Health check endpoint for monitoring
 */

import { NextResponse } from 'next/server';
import { getAnalyticsEngine } from '@quantbot/analytics';

export async function GET() {
  try {
    const startTime = Date.now();
    
    // Quick health checks
    const checks = {
      api: true,
      analytics: false,
      timestamp: new Date().toISOString(),
    };

    // Test analytics engine availability (lightweight check)
    try {
      const engine = getAnalyticsEngine();
      checks.analytics = engine !== null && engine !== undefined;
    } catch {
      // Analytics engine unavailable, but API is still healthy
      checks.analytics = false;
    }

    const responseTime = Date.now() - startTime;

    const status = checks.api && checks.analytics ? 'healthy' : 'degraded';
    const statusCode = checks.api ? 200 : 503;

    return NextResponse.json(
      {
        status,
        checks,
        responseTimeMs: responseTime,
        version: process.env.npm_package_version || '1.0.0',
      },
      { status: statusCode }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: {
          message:
            error instanceof Error ? error.message : 'Internal server error',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

