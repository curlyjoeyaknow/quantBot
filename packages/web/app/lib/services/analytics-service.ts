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
    // Enable ATH enrichment for dashboard - but with reasonable limits
    // Recent calls and top callers should show real ATH data
    const dashboard = await engine.getDashboard({
      enrichWithAth: true, // Enable ATH enrichment to show real metrics
      limit: 500, // Limit to 500 calls for faster loading while still showing meaningful data
    });
    
    // Validate that we got real data
    if (!dashboard || !dashboard.system) {
      console.warn('Dashboard returned empty or invalid data');
      throw new Error('Invalid dashboard data');
    }
    
    return dashboard;
  } catch (error) {
    console.error('Error in getDashboardSummary:', error);
    // Log the full error for debugging
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
      console.error('Error message:', error.message);
    }
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
  try {
    const engine = getAnalyticsEngine();
    await engine.initialize();
    const result = await engine.analyzeCalls({
      from: options?.from,
      to: options?.to,
      callerNames: options?.callerName ? [options.callerName] : undefined,
      enrichWithAth: true, // Enable ATH enrichment for accurate metrics
    });
    
    if (!result || !result.callerMetrics) {
      console.warn('analyzeCalls returned empty or invalid data');
      return [];
    }
    
    // Validate caller metrics have real data
    const validMetrics = result.callerMetrics.filter(
      (metric) => metric && metric.callerName && metric.totalCalls > 0
    );
    
    if (validMetrics.length === 0) {
      console.warn('No valid caller metrics found');
    }
    
    return validMetrics;
  } catch (error) {
    console.error('Error in getCallerMetrics:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
      console.error('Error message:', error.message);
    }
    return [];
  }
}

export async function getAthDistribution(
  options?: {
    from?: Date;
    to?: Date;
    callerName?: string;
  }
): Promise<AthDistribution[]> {
  try {
    const engine = getAnalyticsEngine();
    await engine.initialize();
    // ATH distribution requires enrichWithAth to be true
    const distribution = await engine.getAthDistribution({
      from: options?.from,
      to: options?.to,
      callerNames: options?.callerName ? [options.callerName] : undefined,
      enrichWithAth: true, // Required for ATH distribution
    });
    
    if (!distribution || !Array.isArray(distribution)) {
      console.warn('getAthDistribution returned invalid data');
      return [];
    }
    
    // Filter out invalid entries
    const validDistribution = distribution.filter(
      (item) => 
        item && 
        item.bucket !== undefined && 
        item.count !== undefined && 
        item.count !== null &&
        item.percentage !== undefined &&
        item.avgTimeToAth !== undefined
    );
    
    if (validDistribution.length === 0) {
      console.warn('No valid ATH distribution data found');
    }
    
    return validDistribution;
  } catch (error) {
    console.error('Error in getAthDistribution:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
      console.error('Error message:', error.message);
    }
    return [];
  }
}
