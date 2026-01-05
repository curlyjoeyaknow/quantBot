/**
 * Backtest Engine - Pure deterministic execution for CALLS
 *
 * No I/O, no clocks, no randomness, no global state, no config reads.
 * Entry points come from call timestamps, not arbitrary candles.
 */

import type { Candle, TokenAddress, Chain } from '@quantbot/core';
import type { StrategyV1, BacktestResult, Trade, BacktestEvent, CallRecord } from '../types.js';
import { runOverlaySimulation } from '@quantbot/simulation';

/**
 * Backtest a single call
 *
 * Pure function: deterministic, no side effects.
 * Entry point comes from call timestamp, not first candle.
 * Async only because runOverlaySimulation is async (but still pure).
 */
export async function backtestCall(
  call: CallRecord,
  candles: Candle[],
  strategy: StrategyV1,
  entryDelayCandles: number
): Promise<BacktestResult> {
  if (candles.length === 0) {
    return { trades: [], events: [] };
  }

  // Apply warmup - skip indicator warmup candles
  const warmupCandles = strategy.indicatorWarmup || 0;
  const executionCandles = candles.slice(warmupCandles);

  if (executionCandles.length === 0) {
    return { trades: [], events: [] };
  }

  // Find entry candle: call timestamp + entry delay
  const callTimestampSeconds = call.createdAt.toUnixInteger();
  const intervalSeconds = 60; // TODO: derive from strategy/plan
  const entryDelaySeconds = entryDelayCandles * intervalSeconds;
  const entryTimestampSeconds = callTimestampSeconds + entryDelaySeconds;

  // Find the candle at or after entry timestamp
  let entryCandleIndex = -1;
  for (let i = 0; i < executionCandles.length; i++) {
    if (executionCandles[i]!.timestamp >= entryTimestampSeconds) {
      entryCandleIndex = i;
      break;
    }
  }

  // If no candle found after entry, use last candle
  if (entryCandleIndex === -1) {
    entryCandleIndex = executionCandles.length - 1;
  }

  if (entryCandleIndex < 0 || entryCandleIndex >= executionCandles.length) {
    return { trades: [], events: [] };
  }

  // Entry point: candle at entry timestamp
  const entryCandle = executionCandles[entryCandleIndex];
  const entryPoint = {
    tsMs: entryCandle.timestamp * 1000,
    px: entryCandle.open,
  };

  // Slice candles for execution (from entry to max hold)
  const maxHold = strategy.maxHold || executionCandles.length;
  const executionSlice = executionCandles.slice(entryCandleIndex, entryCandleIndex + maxHold);

  // Run overlay simulation (pure)
  const simResults = await runOverlaySimulation({
    candles: executionSlice,
    entry: entryPoint,
    overlays: strategy.overlays,
    fees: strategy.fees,
    position: strategy.position,
  });

  // Map to trades (per call)
  const trades: Trade[] = simResults.map(
    (result: {
      entry: { tsMs: number; px: number };
      exit: { tsMs: number; px: number };
      exitReason: string;
      pnl: {
        grossReturnPct: number;
        netReturnPct: number;
        feesUsd: number;
        slippageUsd: number;
      };
    }) => ({
      callId: call.id,
      tokenAddress: call.mint,
      chain: 'solana', // TODO: derive from call data
      caller: call.caller,
      entry: result.entry,
      exit: {
        tsMs: result.exit.tsMs,
        px: result.exit.px,
        reason: result.exitReason,
      },
      pnl: result.pnl,
    })
  );

  // Generate events for replay (optional, simplified)
  const events: BacktestEvent[] = [];
  for (const trade of trades) {
    events.push({
      timestamp: trade.entry.tsMs,
      callId: trade.callId,
      tokenAddress: trade.tokenAddress,
      price: trade.entry.px,
      event: 'entry',
    });
    events.push({
      timestamp: trade.exit.tsMs,
      callId: trade.callId,
      tokenAddress: trade.tokenAddress,
      price: trade.exit.px,
      event: `exit_${trade.exit.reason}`,
    });
  }

  return {
    trades,
    events,
  };
}
