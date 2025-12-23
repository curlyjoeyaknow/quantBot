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
import type { RunArtifact, RunMetadata, TradeEvent, PnLSeries } from './artifacts.js';
import { calculateMetrics, calculatePnLSeries } from './metrics.js';
import { getGitSha, getGitBranch, hashValue } from './experiment-runner.js';
import type { WorkflowContext } from '../types.js';
import { DataSnapshotService } from './services/DataSnapshotService.js';
import { simulateStrategy } from '@quantbot/simulation/core/simulator.js';
import type { StrategyConfig, StrategyLeg } from '@quantbot/simulation/strategies/types.js';
import { buildStrategy, buildStopLossConfig } from '@quantbot/simulation/strategies/builder.js';
import type { Candle as SimCandle } from '@quantbot/simulation/types/candle.js';
import { DateTime } from 'luxon';
import { logger, ValidationError } from '@quantbot/utils';
import type { LegacySimulationEvent } from '@quantbot/simulation/types/events.js';
import type {
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '@quantbot/simulation/strategies/types.js';
import type { ExecutionModel as SimExecutionModel } from '@quantbot/simulation/types/execution-model.js';
import {
  createExecutionModel,
  createDefaultExecutionModel,
} from '@quantbot/simulation/execution/index.js';
import { calculateTradeFee } from '@quantbot/simulation/execution/fees.js';

/**
 * Adapter that converts Research OS contract to existing workflow system
 */
export class ResearchSimulationAdapter {
  private readonly snapshotService: DataSnapshotService;

  constructor(private readonly workflowContext: WorkflowContext) {
    this.snapshotService = new DataSnapshotService(workflowContext);
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
    const startTime = Date.now();
    const runId = this.workflowContext.ids.newRunId();
    const nowISO = this.workflowContext.clock.nowISO();

    logger.info('[ResearchSimulationAdapter] Starting simulation', {
      runId,
      snapshotId: request.dataSnapshot.snapshotId,
      strategyId: request.strategy.strategyId,
    });

    try {
      // 1. Load data from snapshot
      const snapshotData = await this.snapshotService.loadSnapshot(request.dataSnapshot);

      // 2. Convert StrategyRef to StrategyConfig
      const strategyConfig = this.convertStrategyRefToConfig(request.strategy);

      // 3. Convert ExecutionModel, CostModel, RiskModel to simulation engine formats
      const executionModelInterface = this.convertExecutionModel(request.executionModel);
      const costConfig = this.convertCostModel(request.costModel);
      const entryConfig = this.extractEntryConfig(strategyConfig);
      const reEntryConfig = this.extractReEntryConfig(strategyConfig);
      const stopLossConfig = buildStopLossConfig(strategyConfig);

      // 4. Run simulation for each call in the snapshot
      const allTradeEvents: TradeEvent[] = [];
      const strategy = buildStrategy(strategyConfig);
      
      // Store costConfig for fee calculation in event conversion
      this.currentCostConfig = costConfig;

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
        const result = await simulateStrategy(
          simCandles,
          strategy,
          stopLossConfig,
          entryConfig,
          reEntryConfig,
          costConfig,
          {
            executionModel: executionModelInterface,
            seed: request.runConfig.seed,
            clockResolution: 'm', // Default to minutes
          }
        );

        // Convert simulation events to TradeEvents
        const tradeEvents = this.convertEventsToTradeEvents(
          result.events,
          call.mint,
          request.runConfig.seed,
          costConfig
        );
        allTradeEvents.push(...tradeEvents);
      }

      // 5. Calculate PnL series and metrics
      const pnlSeries = calculatePnLSeries(allTradeEvents);
      const metrics = calculateMetrics(allTradeEvents, pnlSeries);

      const simulationTimeMs = Date.now() - startTime;

      // 6. Build metadata
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
      logger.error('[ResearchSimulationAdapter] Simulation failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
   * Convert Research OS ExecutionModel to simulation engine ExecutionModel
   */
  private convertExecutionModel(
    contractModel: SimulationRequest['executionModel']
  ): ReturnType<typeof createExecutionModel> {
    // Convert contract ExecutionModel to simulation engine ExecutionModel format
    // Contract model has: latency {p50, p90, p99, jitter}, slippage {base, volumeImpact, max}, failures, partialFills
    // Simulation engine model has: latency {type, params}, slippage {type, params}, partialFills {type, params}, failures {failureProbability, retry}, fees

    const simModel: SimExecutionModel = {
      latency: {
        type: 'normal', // Use normal distribution from p50/p90/p99
        params: {
          mean: contractModel.latency.p50,
          stdDev: (contractModel.latency.p99 - contractModel.latency.p50) / 2.33, // Approximate stdDev from p99
        },
      },
      slippage: {
        type: 'fixed',
        params: {
          bps: Math.round(contractModel.slippage.base * 10000), // Convert fraction to basis points
        },
      },
      partialFills: contractModel.partialFills
        ? {
            type: 'probabilistic',
            params: {
              fillProbability: contractModel.partialFills.probability,
            },
          }
        : undefined,
      failures: contractModel.failures
        ? {
            failureProbability: contractModel.failures.baseRate,
            retry: {
              // Retry configuration not available in contract ExecutionModel
              // Default to no retries for now (can be extended if contract adds retry config)
              maxRetries: 0,
              backoffMs: 1000,
            },
          }
        : undefined,
    };

    return createExecutionModel(simModel);
  }

  /**
   * Convert Research OS CostModel to simulation engine CostConfig
   */
  private convertCostModel(contractModel: SimulationRequest['costModel']): CostConfig {
    // Convert contract CostModel to simulation engine CostConfig
    return {
      entrySlippageBps: contractModel.tradingFee
        ? Math.round(contractModel.tradingFee * 10000)
        : undefined,
      exitSlippageBps: contractModel.tradingFee
        ? Math.round(contractModel.tradingFee * 10000)
        : undefined,
      takerFeeBps: contractModel.tradingFee
        ? Math.round(contractModel.tradingFee * 10000)
        : undefined,
      makerFeeBps: contractModel.tradingFee
        ? Math.round(contractModel.tradingFee * 10000)
        : undefined,
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
        const isEntry = event.type === 'entry' || event.type === 'ladder_entry' || event.type === 're_entry';
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
  return new ResearchSimulationAdapter(workflowContext);
}
