/**
 * Storage Sink
 * ============
 * Sink that automatically stores simulation results to Postgres and ClickHouse.
 *
 * @deprecated This sink has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/storage-sink instead.
 * This file will be removed in a future version.
 */

import { DateTime } from 'luxon';
// eslint-disable-next-line no-restricted-imports
import {
  getStorageEngine,
  SimulationRunsRepository,
  SimulationResultsRepository,
  SimulationEventsRepository,
} from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { SimulationRunContext } from '../core/orchestrator';
import type { SimulationResultSink } from '../core/orchestrator';
import { calculateResultMetrics } from './metrics-calculator';
import { ensureStrategyStored, hashStrategyConfig } from './strategy-storage';

/**
 * Storage sink configuration
 */
export interface StorageSinkConfig {
  /** Auto-store strategies when used */
  autoStoreStrategies?: boolean;
  /** Engine version string */
  engineVersion?: string;
  /** Run type (backtest, optimization, what-if, etc.) */
  runType?: string;
  /** Enable/disable storage */
  enabled?: boolean;
}

/**
 * Default storage sink configuration
 */
export const DEFAULT_STORAGE_SINK_CONFIG: StorageSinkConfig = {
  autoStoreStrategies: true,
  engineVersion: '1.0.0',
  runType: 'backtest',
  enabled: true,
};

/**
 * Storage sink implementation
 */
export class StorageSink implements SimulationResultSink {
  readonly name = 'storage-sink';
  private readonly config: StorageSinkConfig;
  private readonly storageEngine: ReturnType<typeof getStorageEngine>;
  private readonly simulationRunsRepo: SimulationRunsRepository;
  private readonly simulationResultsRepo: SimulationResultsRepository;
  private readonly simulationEventsRepo: SimulationEventsRepository;

  constructor(config: StorageSinkConfig = {}) {
    this.config = { ...DEFAULT_STORAGE_SINK_CONFIG, ...config };
    this.storageEngine = getStorageEngine();
    this.simulationRunsRepo = new SimulationRunsRepository();
    this.simulationResultsRepo = new SimulationResultsRepository();
    this.simulationEventsRepo = new SimulationEventsRepository();
  }

  async handle(context: SimulationRunContext): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // 1. Auto-store strategy if enabled
      let strategyId: number | null = null;
      if (this.config.autoStoreStrategies) {
        strategyId = await ensureStrategyStored(context.scenario);
      }

      // 2. Create simulation run record
      const configHash = hashStrategyConfig(context.scenario);
      const runId = await this.createSimulationRun(context, strategyId, configHash);

      // 3. Calculate metrics
      const metrics = calculateResultMetrics(context.result);

      // 4. Extract period metrics if available
      const periodMetrics =
        'periodMetrics' in context.result && context.result.periodMetrics
          ? context.result.periodMetrics
          : undefined;

      // 5. Store results summary in Postgres
      // Note: storeSimulationResults expects core SimulationResult, but we have simulation package result
      // The types are compatible except for events, which we handle separately
      await this.storageEngine.storeSimulationResults(runId, context.result as any);

      // Update summary with calculated metrics and period metrics
      await this.updateResultsSummary(runId, metrics, periodMetrics);

      // 5. Store events in ClickHouse
      if (context.result.events.length > 0) {
        // Convert LegacySimulationEvent to SimulationEvent (they're compatible except for type)
        const events = context.result.events.map((e) => ({
          ...e,
          type: e.type as any, // Type assertion needed due to re_entry_rejected
        }));
        await this.storageEngine.storeSimulationEvents(
          runId,
          context.target.mint,
          context.target.chain,
          events as any
        );
      }

      // 6. Store aggregates in ClickHouse
      await this.storeAggregates(runId, context, metrics);

      logger.debug('Stored simulation results', {
        runId,
        mint: context.target.mint.substring(0, 20) + '...',
        chain: context.target.chain,
        eventsCount: context.result.events.length,
        hasPeriodMetrics: !!periodMetrics,
        reEntryOpportunities: periodMetrics?.reEntryOpportunities?.length || 0,
      });
    } catch (error) {
      logger.error('Error storing simulation results', error as Error, {
        mint: context.target.mint.substring(0, 20) + '...',
        chain: context.target.chain,
      });
      // Don't throw - allow simulation to continue even if storage fails
    }
  }

  /**
   * Create simulation run record
   */
  private async createSimulationRun(
    context: SimulationRunContext,
    strategyId: number | null,
    configHash: string
  ): Promise<number> {
    const runId = await this.simulationRunsRepo.createRun({
      strategyId: strategyId ?? undefined,
      runType: this.config.runType || 'backtest',
      engineVersion: this.config.engineVersion || '1.0.0',
      configHash,
      config: {
        strategy: context.scenario.strategy,
        stopLoss: context.scenario.stopLoss,
        entry: context.scenario.entry,
        reEntry: context.scenario.reEntry,
        costs: context.scenario.costs,
        entrySignal: context.scenario.entrySignal,
        exitSignal: context.scenario.exitSignal,
      },
      dataSelection: {
        mint: context.target.mint,
        chain: context.target.chain,
        startTime: context.target.startTime.toISO(),
        endTime: context.target.endTime.toISO(),
        alertTime: context.target.alertTime?.toISO(),
        candleCount: context.candles.length,
      },
      status: 'completed',
    });
    return runId;
  }

  /**
   * Update results summary with calculated metrics
   */
  private async updateResultsSummary(
    runId: number,
    metrics: ReturnType<typeof calculateResultMetrics>,
    periodMetrics?: import('../types/results').PeriodMetrics
  ): Promise<void> {
    // Build metadata with period metrics if available
    const metadata: Record<string, unknown> = {};
    if (periodMetrics) {
      metadata.periodMetrics = {
        periodAthPrice: periodMetrics.periodAthPrice,
        periodAthTimestamp: periodMetrics.periodAthTimestamp,
        periodAthMultiple: periodMetrics.periodAthMultiple,
        timeToPeriodAthMinutes: periodMetrics.timeToPeriodAthMinutes,
        periodAtlPrice: periodMetrics.periodAtlPrice,
        periodAtlTimestamp: periodMetrics.periodAtlTimestamp,
        periodAtlMultiple: periodMetrics.periodAtlMultiple,
        postAthDrawdownPrice: periodMetrics.postAthDrawdownPrice,
        postAthDrawdownTimestamp: periodMetrics.postAthDrawdownTimestamp,
        postAthDrawdownPercent: periodMetrics.postAthDrawdownPercent,
        postAthDrawdownMultiple: periodMetrics.postAthDrawdownMultiple,
        reEntryOpportunities: periodMetrics.reEntryOpportunities?.map((opp) => ({
          timestamp: opp.timestamp,
          price: opp.price,
          drawdownFromAth: opp.drawdownFromAth,
          recoveryMultiple: opp.recoveryMultiple,
          recoveryTimestamp: opp.recoveryTimestamp,
        })),
      };
    }

    await this.simulationResultsRepo.upsertSummary({
      simulationRunId: runId,
      finalPnl: metrics.finalPnl,
      maxDrawdown: metrics.maxDrawdown,
      volatility: metrics.volatility,
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      winRate: metrics.winRate,
      tradeCount: metrics.tradeCount,
      avgTradeReturn: metrics.avgTradeReturn,
      medianTradeReturn: metrics.medianTradeReturn,
      reentryCount: metrics.reentryCount,
      ladderEntriesUsed: metrics.ladderEntriesUsed,
      ladderExitsUsed: metrics.ladderExitsUsed,
      averageHoldingMinutes: metrics.averageHoldingMinutes,
      maxHoldingMinutes: metrics.maxHoldingMinutes,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }

  /**
   * Store aggregates in ClickHouse
   */
  private async storeAggregates(
    runId: number,
    context: SimulationRunContext,
    metrics: ReturnType<typeof calculateResultMetrics>
  ): Promise<void> {
    // Note: insertAggregates expects SimulationAggregate which doesn't include simulationRunId
    // The runId is passed separately as the first parameter
    await this.simulationEventsRepo.insertAggregates(runId, {
      tokenAddress: context.target.mint,
      chain: context.target.chain,
      finalPnl: metrics.finalPnl,
      maxDrawdown: metrics.maxDrawdown ?? 0,
      volatility: metrics.volatility ?? 0,
      sharpeRatio: metrics.sharpeRatio ?? 0,
      sortinoRatio: metrics.sortinoRatio ?? 0,
      winRate: metrics.winRate ?? 0,
      tradeCount: metrics.tradeCount,
      reentryCount: metrics.reentryCount,
      ladderEntriesUsed: metrics.ladderEntriesUsed,
      ladderExitsUsed: metrics.ladderExitsUsed,
    });
  }
}

/**
 * Create a storage sink
 */
export function createStorageSink(config?: StorageSinkConfig): StorageSink {
  return new StorageSink(config);
}
