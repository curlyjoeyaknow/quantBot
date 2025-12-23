/**
 * Analytics service - Direct service calls for server components
 */

import { getAnalyticsEngine } from '@quantbot/analytics';
import type {
  DashboardSummary,
  CallerMetrics,
  AthDistribution,
} from '../types';

export async function getDashboardSummary(): Promise<DashboardSummary> {
  try {
    const engine = getAnalyticsEngine();
    await engine.initialize();
    return await engine.getDashboard({
      enrichWithAth: false,
    });
  } catch (error) {
    console.error('Error in getDashboardSummary:', error);
    // Return empty dashboard on error
    return {
      system: {
        totalCalls: 0,
        totalCallers: 0,
        totalTokens: 0,
        dataRange: {
          start: new Date(),
          end: new Date(),
        },
        simulationsTotal: 0,
        simulationsToday: 0,
      },
      topCallers: [],
      athDistribution: [],
      recentCalls: [],
      generatedAt: new Date(),
    };
  }
}

export async function getCallerMetrics(
  options?: {
    from?: Date;
    to?: Date;
    callerName?: string;
  }
): Promise<CallerMetrics[]> {
  const engine = getAnalyticsEngine();
  const result = await engine.analyzeCalls({
    from: options?.from,
    to: options?.to,
    callerNames: options?.callerName ? [options.callerName] : undefined,
    enrichWithAth: false,
  });
  return result.callerMetrics;
}

export async function getAthDistribution(
  options?: {
    from?: Date;
    to?: Date;
    callerName?: string;
  }
): Promise<AthDistribution[]> {
  const engine = getAnalyticsEngine();
  return await engine.getAthDistribution({
    from: options?.from,
    to: options?.to,
    callerNames: options?.callerName ? [options.callerName] : undefined,
    enrichWithAth: false,
  });
}

