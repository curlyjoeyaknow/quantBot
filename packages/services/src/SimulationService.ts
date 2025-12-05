/**
 * Simulation Service
 * ==================
 * Manages simulation run operations including saving and retrieving simulation results.
 * Coordinates between the simulation engine and data persistence.
 */

import { DateTime } from 'luxon';
import { Strategy } from '@quantbot/simulation';
import { StopLossConfig } from '@quantbot/simulation';
import { simulateStrategy, type SimulationResult as SimResult } from '@quantbot/simulation';
import { fetchHybridCandles } from '@quantbot/simulation';
import * as db from '@quantbot/utils';
import type { SimulationRunData } from '@quantbot/utils';

// TODO: Events module needs to be in this package or utils
const eventBus = { 
  emit: (event: string, data: any) => {},
  publish: (event: any) => {} // Add publish method
};
const EventFactory = {
  simulationStarted: (data: any) => ({ type: 'simulation_started', data }),
  simulationCompleted: (data: any) => ({ type: 'simulation_completed', data }),
  simulationFailed: (data: any) => ({ type: 'simulation_failed', data }),
  createUserEvent: (type: string, userId: number, data: any) => ({ type, userId, data })
};

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
 */
export class SimulationService {
  /**
   * Run a simulation with the given parameters
   */
  async runSimulation(params: SimulationParams): Promise<SimResult> {
    const { mint, chain, startTime, endTime, strategy, stopLossConfig, userId } = params;
    
    // Emit simulation started event
    await eventBus.publish(
      EventFactory.createUserEvent('simulation.started', userId, { mint, chain, strategy })
    );
    
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
      await eventBus.publish(
        EventFactory.createUserEvent('simulation.completed', userId, { mint, chain, strategy, result })
      );
      
      return result;
    } catch (error) {
      // Emit simulation failed event
      await eventBus.publish(
        EventFactory.createUserEvent('simulation.failed', userId, { mint, chain, strategy, error: error instanceof Error ? error.message : String(error) })
      );
      
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
    startTime: DateTime;
    endTime: DateTime;
    strategy: Strategy[];
    stopLossConfig: StopLossConfig;
    finalPnl: number;
    totalCandles: number;
    events: any[];
  }): Promise<number> {
    return db.saveSimulationRun(params);
  }

  /**
   * Get simulation runs for a user
   */
  async getUserSimulationRuns(userId: number, limit: number = 10): Promise<SimulationRunData[]> {
    return db.getUserSimulationRuns(userId, limit);
  }

  /**
   * Get a specific simulation run by ID
   */
  async getSimulationRun(runId: number): Promise<SimulationRun | null> {
    return db.getSimulationRun(runId);
  }

  /**
   * Run a complete simulation and save the results
   */
  async runAndSaveSimulation(params: SimulationParams): Promise<SimResult & { runId: number }> {
    const result = await this.runSimulation(params);
    
    const runId = await this.saveSimulationRun({
      userId: params.userId,
      mint: params.mint,
      chain: params.chain,
      startTime: params.startTime,
      endTime: params.endTime || DateTime.utc(),
      strategy: params.strategy,
      stopLossConfig: params.stopLossConfig,
      finalPnl: result.finalPnl,
      totalCandles: result.totalCandles,
      events: result.events,
    });
    
    return { ...result, runId };
  }

  /**
   * Repeat a previous simulation with the same parameters
   */
  async repeatSimulation(userId: number, runIdOrIndex: number): Promise<SimResult> {
    // If it's a small number, treat it as an index
    if (runIdOrIndex < 100) {
      const runs = await this.getUserSimulationRuns(userId, 100);
      const run = runs[runIdOrIndex - 1];
      
      if (!run) {
        throw new Error(`No simulation run found at index ${runIdOrIndex}`);
      }
      
      return this.runSimulation({
        userId,
        mint: run.mint,
        chain: run.chain,
        startTime: run.startTime,
        endTime: run.endTime,
        strategy: run.strategy,
        stopLossConfig: run.stopLossConfig,
      });
    } else {
      // Treat it as a run ID
      const run = await this.getSimulationRun(runIdOrIndex);
      
      if (!run) {
        throw new Error(`Simulation run ${runIdOrIndex} not found`);
      }
      
      return this.runSimulation({
        userId,
        mint: run.mint,
        chain: run.chain,
        startTime: run.startTime,
        endTime: run.endTime,
        strategy: run.strategy,
        stopLossConfig: run.stopLossConfig,
      });
    }
  }
}

// Export singleton instance
export const simulationService = new SimulationService();
