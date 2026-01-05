/**
 * StrategyEngine - Pure simulation engine for Golden Path
 *
 * @deprecated This module uses the legacy Call model and is not recommended for new code.
 * Use runOverlaySimulation() from overlay-simulation.ts instead, which works with CallSignal.
 *
 * This module is kept for backwards compatibility but should not be used in new workflows.
 * It will be removed or refactored to use CallSignal in a future version.
 *
 * Wraps the existing simulateStrategy function to work with Golden Path types.
 * This is a pure function - no DB, no side effects, deterministic.
 */

import { simulateStrategy, type SimulationOptions } from '../core/simulator.js';
import type {
  SimulationResult,
  Candle,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  StrategyLeg,
} from '../types/index.js';
import type { StrategyConfig } from './StrategyConfig.js';
import type { Call } from '@quantbot/core';

export interface SimulationRequest {
  strategy: StrategyConfig;
  candlesByToken: Map<string, Candle[]>; // tokenAddress -> candles
  calls: Call[];
}

export interface SimulationTrace {
  trades: Array<{
    tokenAddress: string;
    callId: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    timestamp: number;
  }>;
  events: Array<{
    callId: number;
    tokenAddress: string;
    event: {
      type: string;
      timestamp: number;
      price: number;
      description: string;
      remainingPosition: number;
      pnlSoFar: number;
    };
  }>;
  aggregates: Map<
    string,
    {
      tokenAddress: string;
      chain: string;
      finalPnl: number;
      maxDrawdown: number;
      volatility: number;
      sharpeRatio: number;
      sortinoRatio: number;
      winRate: number;
      tradeCount: number;
      reentryCount: number;
      ladderEntriesUsed: number;
      ladderExitsUsed: number;
    }
  >;
}

/**
 * Simulate strategy on calls
 *
 * Pure function - deterministic, no side effects
 */
export async function simulateOnCalls(request: SimulationRequest): Promise<SimulationTrace> {
  const trades: SimulationTrace['trades'] = [];
  const events: SimulationTrace['events'] = [];
  const aggregates = new Map<
    string,
    SimulationTrace['aggregates'] extends Map<string, infer V> ? V : never
  >();

  // Group calls by token
  const callsByToken = new Map<string, Call[]>();
  for (const call of request.calls) {
    const tokenKey = `${call.tokenId}`; // We'll need to resolve tokenId to address
    if (!callsByToken.has(tokenKey)) {
      callsByToken.set(tokenKey, []);
    }
    callsByToken.get(tokenKey)!.push(call);
  }

  // Simulate each token
  for (const [tokenKey, tokenCalls] of callsByToken.entries()) {
    // Find candles for this token
    // Note: In practice, you'd need to resolve tokenId to address first
    // This is a simplified version
    const candles = request.candlesByToken.get(tokenKey) || [];

    if (candles.length === 0) {
      continue; // Skip tokens without candles
    }

    // Convert StrategyConfig to simulateStrategy parameters
    const strategyLegs: StrategyLeg[] = request.strategy.profitTargets || [];
    const stopLoss: StopLossConfig | undefined = request.strategy.stopLoss;
    const entry: EntryConfig | undefined = request.strategy.entry;
    const reEntry: ReEntryConfig | undefined = request.strategy.reEntry;

    const options: SimulationOptions = {
      entrySignal: request.strategy.entrySignal,
      exitSignal: request.strategy.exitSignal,
      entryLadder: request.strategy.entryLadder,
      exitLadder: request.strategy.exitLadder,
    };

    // Run simulation
    const result: SimulationResult = await simulateStrategy(
      candles,
      strategyLegs,
      stopLoss,
      entry,
      reEntry,
      undefined, // costConfig - use defaults
      options
    );

    // Process results for each call
    for (const call of tokenCalls) {
      // Map simulation events to calls
      for (const event of result.events) {
        events.push({
          callId: call.id,
          tokenAddress: tokenKey, // Would be resolved to actual address
          event: {
            type: event.type,
            timestamp: event.timestamp,
            price: event.price,
            description: event.description,
            remainingPosition: event.remainingPosition,
            pnlSoFar: event.pnlSoFar,
          },
        });
      }

      // Create trade entry
      trades.push({
        tokenAddress: tokenKey,
        callId: call.id,
        entryPrice: result.entryPrice,
        exitPrice: result.finalPrice,
        pnl: result.finalPnl,
        timestamp: call.signalTimestamp.toSeconds(),
      });
    }

    // Calculate aggregates (simplified - would need proper calculation)
    const tokenAggregate = {
      tokenAddress: tokenKey,
      chain: 'solana', // Would come from call
      finalPnl: result.finalPnl,
      maxDrawdown: 0, // Would calculate from events
      volatility: 0, // Would calculate from price movements
      sharpeRatio: 0, // Would calculate
      sortinoRatio: 0, // Would calculate
      winRate: result.finalPnl > 0 ? 1 : 0, // Simplified
      tradeCount: 1,
      reentryCount: 0, // Would count from events
      ladderEntriesUsed: 0, // Would count from events
      ladderExitsUsed: 0, // Would count from events
    };

    aggregates.set(tokenKey, tokenAggregate);
  }

  return {
    trades,
    events,
    aggregates,
  };
}
