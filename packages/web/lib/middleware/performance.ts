/**
 * Performance Metrics Middleware
 * ==============================
 * Tracks performance metrics for requests
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from './request-id';
import { logger, createLogger } from '../logging/logger';

interface PerformanceMetrics {
  requestId: string;
  method: string;
  path: string;
  duration: number;
  timestamp: string;
}

class PerformanceTracker {
  private metrics: PerformanceMetrics[] = [];
  private maxMetrics = 1000; // Keep last 1000 metrics

  record(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  getAverageDuration(path: string): number {
    const pathMetrics = this.metrics.filter(m => m.path === path);
    if (pathMetrics.length === 0) return 0;
    const sum = pathMetrics.reduce((acc, m) => acc + m.duration, 0);
    return sum / pathMetrics.length;
  }

  getStats() {
    return {
      totalRequests: this.metrics.length,
      averageDuration: this.metrics.length > 0
        ? this.metrics.reduce((acc, m) => acc + m.duration, 0) / this.metrics.length
        : 0,
      slowestPaths: this.getSlowestPaths(10),
    };
  }

  private getSlowestPaths(limit: number): Array<{ path: string; avgDuration: number; count: number }> {
    const pathMap = new Map<string, { total: number; count: number }>();
    
    for (const metric of this.metrics) {
      const existing = pathMap.get(metric.path) || { total: 0, count: 0 };
      pathMap.set(metric.path, {
        total: existing.total + metric.duration,
        count: existing.count + 1,
      });
    }

    return Array.from(pathMap.entries())
      .map(([path, data]) => ({
        path,
        avgDuration: data.total / data.count,
        count: data.count,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }
}

export const performanceTracker = new PerformanceTracker();

/**
 * Performance tracking middleware
 */
export function withPerformanceTracking(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    const startTime = Date.now();
    const requestId = getRequestId(request);

    try {
      const response = await handler(request);
      const duration = Date.now() - startTime;

      // Record metrics
      performanceTracker.record({
        requestId,
        method: request.method,
        path: request.nextUrl.pathname,
        duration,
        timestamp: new Date().toISOString(),
      });

      // Add performance header
      response.headers.set('X-Response-Time', `${duration}ms`);

      // Log slow requests
      if (duration > 1000) {
        const requestLogger = createLogger({ requestId });
        requestLogger.warn('Slow request detected', {
          method: request.method,
          path: request.nextUrl.pathname,
          duration: `${duration}ms`,
        });
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record failed request metrics
      performanceTracker.record({
        requestId,
        method: request.method,
        path: request.nextUrl.pathname,
        duration,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  };
}

