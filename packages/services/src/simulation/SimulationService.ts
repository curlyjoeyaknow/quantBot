/**
 * SimulationService - Orchestrates simulation runs on calls
 * 
 * Coordinates loading strategies, calls, candles, running simulations,
 * and writing results to Postgres and ClickHouse.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { CallSelection, Chain } from '@quantbot/utils/types/core';
import {
  StrategiesRepository,
  CallsRepository,
  SimulationRunsRepository,
  SimulationResultsRepository,
} from '@quantbot/storage/src/postgres/repositories';
import {
  OhlcvRepository,
  SimulationEventsRepository,
} from '@quantbot/storage/src/clickhouse/repositories';
import { simulateOnCalls, parseStrategyConfig, type StrategyConfig } from '@quantbot/simulation/engine';
import type { Candle } from '@quantbot/simulation/models';
import type { SimulationTrace } from '@quantbot/simulation/engine/StrategyEngine';
import type { SimulationEvent, SimulationAggregate } from '@quantbot/simulation/models';

export interface RunOnCallsParams {
  strategyName: string;
  selection: CallSelection;
}

export interface SimulationSummary {
  runId: number;
  finalPnl: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  tokenCount: number;
}

export class SimulationService {
  private strategiesRepo: StrategiesRepository;
  private callsRepo: CallsRepository;
  private runsRepo: SimulationRunsRepository;
  private resultsRepo: SimulationResultsRepository;
  private ohlcvRepo: OhlcvRepository;
  private simEventsRepo: SimulationEventsRepository;

  constructor() {
    // Initialize repositories (they use pool directly, no client needed)
    this.strategiesRepo = new StrategiesRepository();
    this.callsRepo = new CallsRepository();
    this.runsRepo = new SimulationRunsRepository();
    this.resultsRepo = new SimulationResultsRepository();
    // ClickHouse repos need client - will be initialized when needed
    // For now, these are placeholders
    this.ohlcvRepo = null as any;
    this.simEventsRepo = null as any;
  }

  /**
   * Run simulation on a selection of calls
   */
  async runOnCalls(params: RunOnCallsParams): Promise<SimulationSummary> {
    logger.info('Starting simulation run', {
      strategyName: params.strategyName,
      selection: params.selection,
    });

      // 1. Create simulation_runs row (status: pending)
      const run = await this.runsRepo.createRun({
        strategyId: undefined, // Would resolve from strategy name
        tokenId: undefined,
        callerId: undefined,
        runType: 'backtest',
        engineVersion: '1.0.0',
        configHash: this.hashConfig(params.strategyName),
        config: { strategyName: params.strategyName },
        dataSelection: params.selection,
      });
      const runId = run.id;

    try {
      await this.runsRepo.updateRunStatus(runId, 'running');

      // 2. Load strategy
      const strategyRecord = await this.strategiesRepo.getStrategyByName(params.strategyName);
      if (!strategyRecord) {
        throw new Error(`Strategy not found: ${params.strategyName}`);
      }

      const strategyConfig = parseStrategyConfig(strategyRecord.config);
      logger.info('Loaded strategy', { strategyName: params.strategyName });

      // 3. Load calls + tokens
      const calls = await this.callsRepo.queryBySelection(params.selection);
      logger.info('Loaded calls', { count: calls.length });

      if (calls.length === 0) {
        throw new Error('No calls found matching selection criteria');
      }

      // 4. Group calls by token and load candles
      const tokenIds = new Set(calls.map(c => c.tokenId));
      const candlesByToken = new Map<string, Candle[]>();

      // TODO: Resolve tokenIds to addresses
      // For now, we'll need to load tokens to get addresses
      // This is a simplified version - in practice you'd join with tokens table

      // 5. Load candles from ClickHouse for each token
      for (const tokenId of tokenIds) {
        // TODO: Resolve tokenId to address
        // const token = await tokensRepo.findById(tokenId);
        // const address = token.address;
        
        // For now, skip - this needs token resolution
        logger.warn('Token resolution not yet implemented', { tokenId });
      }

      // 6. Call StrategyEngine.simulateOnCalls
      // Note: This is simplified - we need token addresses for candlesByToken
      const trace: SimulationTrace = simulateOnCalls({
        strategy: strategyConfig,
        candlesByToken: new Map(), // Would be populated with actual candles
        calls,
      });

      // 7. Write events & aggregates to ClickHouse
      // TODO: Initialize ClickHouse repos with client
      // For now, skip ClickHouse writes - they'll be implemented when ClickHouse client is available
      logger.warn('ClickHouse event/aggregate writes not yet implemented', {
        runId,
        eventCount: trace.events.length,
        aggregateCount: trace.aggregates.size,
      });

      // 8. Calculate summary metrics
      const totalPnl = Array.from(trace.aggregates.values()).reduce(
        (sum, agg) => sum + agg.finalPnl,
        0
      );
      const totalTrades = trace.trades.length;
      const winningTrades = trace.trades.filter(t => t.pnl > 0).length;
      const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
      const maxDrawdown = Math.min(
        ...Array.from(trace.aggregates.values()).map(agg => agg.maxDrawdown)
      );

      // 9. Write summary row to Postgres
      await this.resultsRepo.upsertSummary({
        simulationRunId: runId,
        finalPnl: totalPnl,
        maxDrawdown,
        winRate,
        tradeCount: totalTrades,
        // Additional metrics would be calculated here
      });

      // 10. Update simulation_runs status
      await this.runsRepo.updateRunStatus(runId, 'completed');

      const summary: SimulationSummary = {
        runId,
        finalPnl: totalPnl,
        maxDrawdown,
        winRate,
        tradeCount: totalTrades,
        tokenCount: trace.aggregates.size,
      };

      logger.info('Simulation run completed', summary);
      return summary;
    } catch (error) {
      await this.runsRepo.updateRunStatus(
        runId,
        'failed',
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Hash strategy config for deduplication
   */
  private hashConfig(strategyName: string): string {
    // Simple hash - in practice would use proper hashing
    return `hash_${strategyName}_${Date.now()}`;
  }
}

