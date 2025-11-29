/**
 * Simulation Service
 * ==================
 * Manages simulation run operations.
 * NOTE: Actual simulation execution should call core service API.
 * This service only handles database operations for bot-initiated simulations.
 */

import { DateTime } from 'luxon';
import { Strategy, simulateStrategy, SimulationResult } from '../simulation/engine';
import { StopLossConfig } from '../simulation/config';
import { fetchHybridCandles } from '../simulation/candles';
import * as db from '../database/client';
import { SimulationRunData } from '../types/session';
import { eventBus, EventFactory } from '../events';

export interface SimulationRun {
  id: number;
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  startTime: DateTime;
  endTime: DateTime;
  strategy: Strategy[];
  stopLossConfig: StopLossConfig;
  finalPnl: number;
  totalCandles: number;
  createdAt: DateTime;
}

export interface SimulationParams {
  mint: string;
  chain: string;
  startTime: DateTime;
  endTime?: DateTime;
  strategy: Strategy[];
  stopLossConfig: StopLossConfig;
  userId: number;
}

/**
 * Service for managing simulation operations
 * NOTE: This is a stub that will be replaced with API calls to core service
 */
export class SimulationService {
  /**
   * Run a simulation with the given parameters
   */
  async runSimulation(params: SimulationParams): Promise<SimulationResult> {
    const { mint, chain, startTime, endTime, strategy, stopLossConfig, userId } = params;
    
    // Emit simulation started event
    await eventBus.publish(EventFactory.createUserEvent(
      'simulation.started',
      { mint, chain, strategy },
      'SimulationService',
      userId
    ));
    
    try {
      // Fetch candles for the simulation period
      const endDateTime = endTime || DateTime.utc();
      const candles = await fetchHybridCandles(mint, startTime, endDateTime, chain);
      
      if (candles.length === 0) {
        throw new Error('No candle data available for simulation period');
      }
      
      // Run the simulation
      const result = simulateStrategy(candles, strategy, stopLossConfig);
      
      // Emit simulation completed event
      await eventBus.publish(EventFactory.createUserEvent(
        'simulation.completed',
        { mint, chain, strategy, result },
        'SimulationService',
        userId
      ));
      
      return result;
    } catch (error) {
      // Emit simulation failed event
      await eventBus.publish(EventFactory.createUserEvent(
        'simulation.failed',
        { mint, chain, strategy, error: error instanceof Error ? error.message : String(error) },
        'SimulationService',
        userId
      ));
      
      throw error;
    }
  }

  /**
   * Save a simulation run to the database
   */
  async saveSimulationRun(params: {
    userId: number;
    mint: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    startTime: string | DateTime;
    endTime: string | DateTime;
    strategy: string | Strategy[];
    stopLossConfig: string | StopLossConfig;
    strategyName?: string;
    finalPnl: number;
    totalCandles: number;
  }): Promise<number> {
    return db.saveSimulationRun({
      userId: params.userId,
      mint: params.mint,
      chain: params.chain,
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      startTime: params.startTime instanceof DateTime ? params.startTime.toISO() : params.startTime,
      endTime: params.endTime instanceof DateTime ? params.endTime.toISO() : params.endTime,
      strategy: typeof params.strategy === 'string' ? params.strategy : JSON.stringify(params.strategy),
      stopLossConfig: typeof params.stopLossConfig === 'string' ? params.stopLossConfig : JSON.stringify(params.stopLossConfig),
      strategyName: params.strategyName,
      finalPnl: params.finalPnl,
      totalCandles: params.totalCandles,
    });
  }

  /**
   * Get user simulation runs
   */
  async getUserSimulationRuns(userId: number, limit: number = 10): Promise<SimulationRunData[]> {
    const runs = await db.getUserSimulationRuns(userId, limit);
    return runs.map((run: any) => ({
      id: run.id,
      mint: run.mint,
      chain: run.chain,
      tokenName: run.token_name,
      tokenSymbol: run.token_symbol,
      startTime: DateTime.fromISO(run.start_time),
      endTime: DateTime.fromISO(run.end_time),
      strategy: typeof run.strategy === 'string' ? JSON.parse(run.strategy) : run.strategy,
      stopLossConfig: typeof run.stop_loss_config === 'string' ? JSON.parse(run.stop_loss_config) : run.stop_loss_config,
      finalPnl: run.final_pnl,
      totalCandles: run.total_candles,
      events: [], // Events would need separate query
      createdAt: DateTime.fromISO(run.created_at),
    }));
  }
}

