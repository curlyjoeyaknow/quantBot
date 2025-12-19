/**
 * Analytics Engine
 * ================
 * Core engine for historical analytics and performance metrics.
 * Orchestrates data loading, aggregation, and metric calculation.
 */

import { logger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
import type {
  CallPerformance,
  CallerMetrics,
  AthDistribution,
  SystemMetrics,
  DashboardSummary,
} from '../types';
import { CallDataLoader } from '../loaders/CallDataLoader';
import { MetricsAggregator } from '../aggregators/MetricsAggregator';

export interface AnalyticsOptions {
  /** Date range for analysis */
  from?: Date;
  to?: Date;
  /** Filter by caller names */
  callerNames?: string[];
  /** Filter by chains */
  chains?: string[];
  /** Maximum number of calls to analyze */
  limit?: number;
  /** Enrich with ATH data from OHLCV */
  enrichWithAth?: boolean;
}

export interface AnalyticsResult {
  /** Processed calls */
  calls: CallPerformance[];
  /** Caller metrics */
  callerMetrics: CallerMetrics[];
  /** ATH distribution */
  athDistribution: AthDistribution[];
  /** System metrics */
  systemMetrics: SystemMetrics;
  /** Dashboard summary */
  dashboard: DashboardSummary;
  /** Metadata */
  metadata: {
    totalCalls: number;
    processedCalls: number;
    enrichedCalls: number;
    processingTimeMs: number;
  };
}

/**
 * Analytics Engine - Production-ready analytics system
 */
export class AnalyticsEngine {
  private callLoader: CallDataLoader;
  private aggregator: MetricsAggregator;
  private initialized = false;

  constructor() {
    this.callLoader = new CallDataLoader();
    this.aggregator = new MetricsAggregator();
  }

  /**
   * Initialize the engine (lazy initialization)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Verify database connection (ClickHouse instead of PostgreSQL)
      const client = getClickHouseClient();
      await client.query({ query: 'SELECT 1', format: 'JSON' });

      this.initialized = true;
      logger.info('[AnalyticsEngine] Initialized');
    } catch (error: unknown) {
      logger.error('[AnalyticsEngine] Failed to initialize', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Analyze call performance
   */
  async analyzeCalls(options: AnalyticsOptions = {}): Promise<AnalyticsResult> {
    await this.initialize();

    const startTime = Date.now();
    logger.info('[AnalyticsEngine] Starting call analysis', options as Record<string, unknown>);

    try {
      // 1. Load calls from database
      const calls = await this.callLoader.loadCalls({
        from: options.from,
        to: options.to,
        callerNames: options.callerNames,
        chains: options.chains,
        limit: options.limit,
      });

      logger.info(`[AnalyticsEngine] Loaded ${calls.length} calls`);

      // 2. Enrich with ATH data if requested
      let enrichedCalls = calls;
      if (options.enrichWithAth) {
        enrichedCalls = await this.callLoader.enrichWithAth(calls);
        logger.info(`[AnalyticsEngine] Enriched ${enrichedCalls.length} calls with ATH data`);
      }

      // 3. Aggregate metrics
      const callerMetrics = this.aggregator.aggregateCallerMetrics(enrichedCalls);
      const athDistribution = this.aggregator.calculateAthDistribution(enrichedCalls);
      const systemMetrics = await this.aggregator.calculateSystemMetrics(enrichedCalls);

      // 4. Build dashboard summary
      const dashboard: DashboardSummary = {
        system: systemMetrics,
        topCallers: callerMetrics.slice(0, 10), // Top 10 callers
        athDistribution,
        recentCalls: enrichedCalls.slice(0, 50).reverse(), // Most recent 50
        generatedAt: new Date(),
      };

      const processingTime = Date.now() - startTime;

      const result: AnalyticsResult = {
        calls: enrichedCalls,
        callerMetrics,
        athDistribution,
        systemMetrics,
        dashboard,
        metadata: {
          totalCalls: calls.length,
          processedCalls: enrichedCalls.length,
          enrichedCalls: options.enrichWithAth ? enrichedCalls.length : 0,
          processingTimeMs: processingTime,
        },
      };

      logger.info('[AnalyticsEngine] Analysis complete', {
        calls: result.metadata.totalCalls,
        processingTime: `${(processingTime / 1000).toFixed(2)}s`,
      });

      return result;
    } catch (error: unknown) {
      logger.error('[AnalyticsEngine] Analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get caller performance metrics
   */
  async getCallerMetrics(
    callerName: string,
    options: AnalyticsOptions = {}
  ): Promise<CallerMetrics | null> {
    const result = await this.analyzeCalls({
      ...options,
      callerNames: [callerName],
    });

    return result.callerMetrics.find((m) => m.callerName === callerName) || null;
  }

  /**
   * Get ATH distribution
   */
  async getAthDistribution(options: AnalyticsOptions = {}): Promise<AthDistribution[]> {
    const result = await this.analyzeCalls({
      ...options,
      enrichWithAth: true,
    });

    return result.athDistribution;
  }

  /**
   * Get dashboard summary
   */
  async getDashboard(options: AnalyticsOptions = {}): Promise<DashboardSummary> {
    const result = await this.analyzeCalls({
      ...options,
      enrichWithAth: true,
    });

    return result.dashboard;
  }
}

// Singleton instance
let engineInstance: AnalyticsEngine | null = null;

/**
 * Get analytics engine instance
 */
export function getAnalyticsEngine(): AnalyticsEngine {
  if (!engineInstance) {
    engineInstance = new AnalyticsEngine();
  }
  return engineInstance;
}
