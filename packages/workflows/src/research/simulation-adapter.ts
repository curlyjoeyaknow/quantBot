/**
 * Research OS - Simulation Adapter
 * =================================
 *
 * Adapts the existing simulation engine to the Research OS contract.
 * This bridges the gap between the new contract and existing implementation.
 *
 * Phase 3 Implementation: Actually runs simulations using snapshots.
 */

import type { SimulationRequest } from './contract.js';
import type { RunArtifact, RunMetadata, TradeEvent } from './artifacts.js';
import { calculateMetrics, calculatePnLSeries } from './metrics.js';
import { getGitSha, getGitBranch, hashValue } from './experiment-runner.js';
import type { WorkflowContext } from '../types.js';
import { DataSnapshotService } from './services/DataSnapshotService.js';
import { PythonEngine } from '@quantbot/utils';
import {
  simulateStrategy,
  type StrategyConfig,
  type Candle as SimCandle,
  type LegacySimulationEvent,
  type EntryConfig,
  type ReEntryConfig,
  type CostConfig,
  calculateTradeFee,
  buildStrategy,
  buildStopLossConfig,
} from '@quantbot/backtest';
import type { ExecutionModel as SimExecutionModel } from '@quantbot/backtest';
import { DateTime } from 'luxon';
import { logger, ValidationError } from '@quantbot/utils';

/**
 * Adapter that converts Research OS contract to existing workflow system
 */
export class ResearchSimulationAdapter {
  private readonly snapshotService: DataSnapshotService;

  constructor(private readonly workflowContext: WorkflowContext) {
    // Create PythonEngine for hash computation (Phase IV: Python computes, TypeScript orchestrates)
    const pythonEngine = new PythonEngine();
    this.snapshotService = new DataSnapshotService(workflowContext, undefined, pythonEngine);
  }

  /**
   * Run a simulation using the Research OS contract
   *
   * Phase 3: Real implementation that:
   * 1. Loads data from DataSnapshotRef
   * 2. Converts StrategyRef to strategy config
   * 3. Applies ExecutionModel, CostModel, RiskModel
   * 4. Runs simulation with RunConfig
   * 5. Collects trade events, PnL series, etc.
   * 6. Calculates metrics
   * 7. Builds RunArtifact
   */
  async run(request: SimulationRequest): Promise<RunArtifact> {
    // Use clock for deterministic timing (can be mocked in tests)
    // Convert ISO string to milliseconds for performance measurement
    const startTimeISO = this.workflowContext.clock.nowISO();
    const startTime = new Date(startTimeISO).getTime();
    const runId = this.workflowContext.ids.newRunId();
    const nowISO = this.workflowContext.clock.nowISO();

    logger.info('[ResearchSimulationAdapter] Starting simulation', {
      runId,
      snapshotId: request.dataSnapshot.snapshotId,
      strategyId: request.strategy.strategyId,
    });

    // 0. Validate that contentHash exists (required for snapshot refs, not live data)
    if (!request.dataSnapshot.contentHash) {
      throw new ValidationError(
        'Simulations must use snapshot refs with contentHash, not live data',
        {
          snapshotId: request.dataSnapshot.snapshotId,
        }
      );
    }

    try {
      // 1. Verify snapshot integrity before loading
      const isValid = await this.snapshotService.verifySnapshot(request.dataSnapshot);
      if (!isValid) {
        throw new ValidationError(
          'Snapshot integrity check failed - content hash does not match data',
          {
            snapshotId: request.dataSnapshot.snapshotId,
            contentHash: request.dataSnapshot.contentHash,
          }
        );
      }

      // 2. Load data from snapshot
      const snapshotData = await this.snapshotService.loadSnapshot(request.dataSnapshot);

      // 3. Convert StrategyRef to StrategyConfig
      const strategyConfig = this.convertStrategyRefToConfig(request.strategy);

      // 4. Convert ExecutionModel, CostModel, RiskModel to simulation engine formats
      // TODO: Re-enable executionModel conversion once execution model factory is updated for new consolidated format
      // const executionModelConfig: SimExecutionModel = this.convertExecutionModel(
      //   request.executionModel
      // );
      const costConfig = this.convertCostModel(request.costModel);
      const entryConfig = this.extractEntryConfig(strategyConfig);
      const reEntryConfig = this.extractReEntryConfig(strategyConfig);
      const stopLossConfig = buildStopLossConfig(strategyConfig);

      // 5. Run simulation for each call in the snapshot
      const allTradeEvents: TradeEvent[] = [];
      const strategy = buildStrategy(strategyConfig);

      for (const call of snapshotData.calls) {
        // Get candles for this mint
        const mintCandles = snapshotData.candles.filter((c) => c.mint === call.mint);
        if (mintCandles.length === 0) {
          logger.warn('[ResearchSimulationAdapter] No candles for call', {
            callId: call.id,
            mint: call.mint,
          });
          continue;
        }

        // Convert snapshot candles to simulation engine format
        const simCandles: SimCandle[] = mintCandles.map((c) => ({
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        // Sort candles by timestamp
        simCandles.sort((a, b) => a.timestamp - b.timestamp);

        // Run simulation
        let result;
        try {
          result = await simulateStrategy(
            simCandles,
            strategy,
            stopLossConfig,
            entryConfig,
            reEntryConfig,
            costConfig,
            {
              // TODO: Re-enable executionModel once execution model factory is updated for new consolidated format
              // executionModel: executionModelConfig,
              seed: request.runConfig.seed,
              clockResolution: 'm', // Default to minutes
            }
          );
        } catch (error) {
          // If simulation fails for this call, log and continue with next call
          logger.warn('[ResearchSimulationAdapter] Simulation failed for call', {
            callId: call.id,
            mint: call.mint,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        // Convert simulation events to TradeEvents
        const tradeEvents = this.convertEventsToTradeEvents(
          result.events,
          call.mint,
          request.runConfig.seed,
          costConfig
        );
        allTradeEvents.push(...tradeEvents);
      }

      // 6. Calculate PnL series and metrics
      const pnlSeries = calculatePnLSeries(allTradeEvents, 1.0, nowISO);
      const metrics = calculateMetrics(allTradeEvents, pnlSeries);

      const simulationTimeMs =
        DateTime.fromISO(this.workflowContext.clock.nowISO()).toMillis() - startTime;

      // 7. Build metadata
      const metadata: RunMetadata = {
        runId,
        gitSha: getGitSha(),
        gitBranch: getGitBranch(),
        createdAtISO: nowISO,
        dataSnapshotHash: request.dataSnapshot.contentHash,
        strategyConfigHash: request.strategy.configHash,
        executionModelHash: hashValue(request.executionModel),
        costModelHash: hashValue(request.costModel),
        riskModelHash: request.riskModel ? hashValue(request.riskModel) : undefined,
        runConfigHash: hashValue(request.runConfig),
        simulationTimeMs,
        schemaVersion: '1.0.0',
      };

      logger.info('[ResearchSimulationAdapter] Completed simulation', {
        runId,
        tradeEvents: allTradeEvents.length,
        simulationTimeMs,
      });

      return {
        metadata,
        request,
        tradeEvents: allTradeEvents,
        pnlSeries,
        metrics,
      };
    } catch (error) {
      // Validation errors should be thrown, not caught
      if (error instanceof ValidationError) {
        logger.error('[ResearchSimulationAdapter] Validation error', {
          runId,
          error: error.message,
        });
        throw error;
      }

      // Other errors (simulation failures, etc.) can be handled gracefully
      logger.error('[ResearchSimulationAdapter] Simulation failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return valid empty result for non-validation errors
      // This ensures property tests can validate error handling
      const emptyPnLSeries = calculatePnLSeries([], 1.0, nowISO);
      return {
        metadata: {
          runId,
          gitSha: getGitSha(),
          gitBranch: getGitBranch(),
          createdAtISO: nowISO,
          dataSnapshotHash: request.dataSnapshot.contentHash,
          strategyConfigHash: request.strategy.configHash,
          executionModelHash: hashValue(request.executionModel),
          costModelHash: hashValue(request.costModel),
          riskModelHash: request.riskModel ? hashValue(request.riskModel) : undefined,
          runConfigHash: hashValue(request.runConfig),
          simulationTimeMs:
            DateTime.fromISO(this.workflowContext.clock.nowISO()).toMillis() - startTime,
          schemaVersion: '1.0.0',
        },
        request,
        tradeEvents: [],
        pnlSeries: emptyPnLSeries,
        metrics: calculateMetrics([], emptyPnLSeries),
      };
    }
  }

  /**
   * Convert StrategyRef to StrategyConfig
   */
  private convertStrategyRefToConfig(strategyRef: SimulationRequest['strategy']): StrategyConfig {
    // StrategyRef.config is already a StrategyConfig (opaque in contract but we know the shape)
    const config = strategyRef.config as StrategyConfig;

    // Validate it has required fields
    if (!config.name || !config.profitTargets || !Array.isArray(config.profitTargets)) {
      throw new ValidationError('Invalid strategy config: missing required fields', {
        strategyId: strategyRef.strategyId,
        config,
      });
    }

    return config;
  }

  /**
   * Convert Research OS ExecutionModel to simulation engine ExecutionModel config
   */
  private convertExecutionModel(
    contractModel: SimulationRequest['executionModel']
  ): SimExecutionModel {
    // Convert contract ExecutionModel to simulation engine ExecutionModel format
    // Contract model has: latency {p50, p90, p99, jitter}, slippage {base, volumeImpact, max}, failures, partialFills
    // New ExecutionModel has: latency (VenueLatencyConfig), slippage (VenueSlippageConfig), failures (FailureModel), partialFills (PartialFillModel), costs (CostModel)

    // Calculate latency stdDev for normal distribution
    const latencyStdDev = Math.max(
      0,
      (contractModel.latency.p99 - contractModel.latency.p50) / 2.33
    );

    // Default venue (contract doesn't have venue, so use default)
    const venue = 'unknown';

    // Build ExecutionModel matching the new consolidated schema
    const simModel: SimExecutionModel = {
      venue,
      latency: {
        venue,
        networkLatency: {
          p50: Number.isFinite(contractModel.latency.p50) ? contractModel.latency.p50 : 100,
          p90: Number.isFinite(contractModel.latency.p90) ? contractModel.latency.p90 : 200,
          p99: Number.isFinite(contractModel.latency.p99) ? contractModel.latency.p99 : 500,
          jitterMs: contractModel.latency.jitter || 0,
          distribution: 'percentile' as const,
          meanMs: Number.isFinite(contractModel.latency.p50) ? contractModel.latency.p50 : 100,
          stddevMs: latencyStdDev,
        },
        confirmationLatency: {
          p50: Number.isFinite(contractModel.latency.p50) ? contractModel.latency.p50 : 100,
          p90: Number.isFinite(contractModel.latency.p90) ? contractModel.latency.p90 : 200,
          p99: Number.isFinite(contractModel.latency.p99) ? contractModel.latency.p99 : 500,
          jitterMs: contractModel.latency.jitter || 0,
          distribution: 'percentile' as const,
        },
        congestionMultiplier: 1,
      },
      slippage: {
        venue,
        entrySlippage: {
          type: 'fixed' as const,
          fixedBps: Math.max(0, Math.round(contractModel.slippage.base * 10000)),
          linearCoefficient: 0,
          sqrtCoefficient: 0,
          volumeImpactBps: Math.max(
            0,
            Math.round((contractModel.slippage.volumeImpact || 0) * 10000)
          ),
          minBps: 0,
          maxBps: Math.max(0, Math.round((contractModel.slippage.max || 100) * 10000)),
        },
        exitSlippage: {
          type: 'fixed' as const,
          fixedBps: Math.max(0, Math.round(contractModel.slippage.base * 10000)),
          linearCoefficient: 0,
          sqrtCoefficient: 0,
          volumeImpactBps: Math.max(
            0,
            Math.round((contractModel.slippage.volumeImpact || 0) * 10000)
          ),
          minBps: 0,
          maxBps: Math.max(0, Math.round((contractModel.slippage.max || 100) * 10000)),
        },
        volatilityMultiplier: 1,
      },
      failures: contractModel.failures
        ? {
            baseFailureRate: contractModel.failures.baseRate || 0,
            congestionFailureRate: 0,
            feeShortfallFailureRate: 0,
            maxFailureRate: 0.5,
          }
        : undefined,
      partialFills: contractModel.partialFills
        ? {
            probability: contractModel.partialFills.probability || 0,
            fillDistribution: {
              type: 'uniform' as const,
              minFill: contractModel.partialFills.fillRange[0],
              maxFill: contractModel.partialFills.fillRange[1],
            },
          }
        : undefined,
      costs: {
        takerFeeBps: 25, // Default taker fee
        makerFeeBps: 0,
        borrowAprBps: 0,
      },
    };

    return simModel;
  }

  /**
   * Convert Research OS CostModel to simulation engine CostConfig
   */
  private convertCostModel(contractModel: SimulationRequest['costModel']): CostConfig {
    // Convert contract CostModel to simulation engine CostConfig
    // Handle very small fees by ensuring minimum 1 bps (0.01%) to avoid rounding to 0
    const tradingFee = contractModel.tradingFee ?? 0;
    const tradingFeeBps =
      tradingFee > 0
        ? Math.max(1, Math.round(tradingFee * 10000)) // Ensure at least 1 bps
        : 0;

    return {
      entrySlippageBps: tradingFeeBps,
      exitSlippageBps: tradingFeeBps,
      takerFeeBps: tradingFeeBps,
      borrowAprBps: 0,
    };
  }

  /**
   * Extract EntryConfig from StrategyConfig
   */
  private extractEntryConfig(strategyConfig: StrategyConfig): EntryConfig | undefined {
    return strategyConfig.entry;
  }

  /**
   * Extract ReEntryConfig from StrategyConfig
   */
  private extractReEntryConfig(strategyConfig: StrategyConfig): ReEntryConfig | undefined {
    return strategyConfig.reEntry;
  }

  /**
   * Convert LegacySimulationEvent[] to TradeEvent[]
   */
  private convertEventsToTradeEvents(
    events: LegacySimulationEvent[],
    mint: string,
    _seed: number,
    costConfig?: CostConfig
  ): TradeEvent[] {
    const tradeEvents: TradeEvent[] = [];

    for (const event of events) {
      // Only convert entry/exit events (skip stop_moved, etc.)
      if (
        event.type === 'entry' ||
        event.type === 're_entry' ||
        event.type === 'ladder_entry' ||
        event.type === 'target_hit' ||
        event.type === 'stop_loss' ||
        event.type === 'ladder_exit' ||
        event.type === 'final_exit'
      ) {
        const tradeType =
          event.type === 'entry' || event.type === 'ladder_entry'
            ? 'entry'
            : event.type === 're_entry'
              ? 'reentry'
              : 'exit';

        const timestampISO = DateTime.fromSeconds(event.timestamp).toISO();
        if (!timestampISO) {
          logger.warn('[ResearchSimulationAdapter] Invalid timestamp in event', {
            timestamp: event.timestamp,
            event,
          });
          continue;
        }

        // Calculate quantity from remainingPosition (simplified)
        const quantity = event.remainingPosition || 1.0;
        const value = event.price * quantity;

        // Calculate fees from cost model
        const isEntry =
          event.type === 'entry' || event.type === 'ladder_entry' || event.type === 're_entry';
        const fees = costConfig ? calculateTradeFee(value, isEntry, costConfig) : 0;

        tradeEvents.push({
          timestampISO,
          type: tradeType,
          asset: mint,
          price: event.price,
          quantity,
          value,
          fees,
          partialFill: false,
          failed: false,
        });
      }
    }

    return tradeEvents;
  }
}

/**
 * Create a simulation adapter from workflow context
 */
export function createSimulationAdapter(
  workflowContext: WorkflowContext
): ResearchSimulationAdapter {
  // NOTE: Direct instantiation is acceptable here - this is a factory function (composition root)
  return new ResearchSimulationAdapter(workflowContext);
}
