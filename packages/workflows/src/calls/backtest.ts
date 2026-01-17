/**
 * Call Overlay Evaluation - Thin adapter for overlay-based simulation
 *
 * This is a thin adapter that:
 * - Calls runOverlaySimulation() from @quantbot/simulation
 * - Maps OverlaySimulationResult to CallBacktestResult
 *
 * No math, no trade mechanics, no simulation logic.
 * All of that lives in @quantbot/simulation.
 */

import type { AlignedCall } from './align.js';
import type { Candle } from '@quantbot/core';
import { runOverlaySimulation } from '@quantbot/simulation';
import type { ExitOverlay, FeeModel, PositionModel } from '@quantbot/simulation';

// Re-export types from @quantbot/simulation for convenience
export type { ExitOverlay, FeeModel, PositionModel } from '@quantbot/simulation';

/**
 * Backtest parameters
 */
export type BacktestParams = {
  fee: FeeModel;
  overlays: ExitOverlay[]; // Strategy overlays to apply
  position: PositionModel; // Normalize across callers
};

/**
 * Backtest result for a single call with one overlay
 */
export type CallBacktestResult = {
  call: AlignedCall['call'];
  overlay: ExitOverlay;

  entry: { tsMs: number; px: number };
  exit: { tsMs: number; px: number; reason: string };

  pnl: {
    grossReturnPct: number;
    netReturnPct: number;
    feesUsd: number;
    slippageUsd: number;
  };

  diagnostics: {
    candlesUsed: number;
    tradeable: boolean;
    skippedReason?: string;
  };
};

/**
 * Evaluate call overlays using @quantbot/simulation
 *
 * Thin adapter that:
 * 1. Slices candles from entry point
 * 2. Calls runOverlaySimulation() from @quantbot/simulation
 * 3. Maps OverlaySimulationResult to CallBacktestResult
 *
 * No math, no trade mechanics - all of that is in @quantbot/simulation.
 *
 * @param aligned - Aligned call (must have entry.candleIndex set)
 * @param candles - Array of candles (must be sorted by timestamp ascending)
 * @param params - Backtest parameters (fees, overlays, position size)
 * @returns Array of backtest results (one per overlay)
 */
export async function evaluateCallOverlays(
  aligned: AlignedCall,
  candles: Candle[],
  params: BacktestParams
): Promise<CallBacktestResult[]> {
  // Check eligibility
  if (!aligned.eligibility.tradeable) {
    return params.overlays.map((overlay) => ({
      call: aligned.call,
      overlay,
      entry: { tsMs: aligned.entry.tsMs, px: 0 },
      exit: { tsMs: aligned.entry.tsMs, px: 0, reason: 'not_tradeable' },
      pnl: {
        grossReturnPct: 0,
        netReturnPct: 0,
        feesUsd: 0,
        slippageUsd: 0,
      },
      diagnostics: {
        candlesUsed: 0,
        tradeable: false,
        skippedReason: aligned.eligibility.reason,
      },
    }));
  }

  // Check if we have enough candles
  if (candles.length === 0 || aligned.entry.candleIndex === undefined) {
    return params.overlays.map((overlay) => ({
      call: aligned.call,
      overlay,
      entry: { tsMs: aligned.entry.tsMs, px: 0 },
      exit: { tsMs: aligned.entry.tsMs, px: 0, reason: 'no_candles' },
      pnl: {
        grossReturnPct: 0,
        netReturnPct: 0,
        feesUsd: 0,
        slippageUsd: 0,
      },
      diagnostics: {
        candlesUsed: 0,
        tradeable: true,
        skippedReason: 'no_candles',
      },
    }));
  }

  const entryCandleIndex = aligned.entry.candleIndex;
  const entryCandle = candles[entryCandleIndex];
  if (!entryCandle) {
    return params.overlays.map((overlay) => ({
      call: aligned.call,
      overlay,
      entry: { tsMs: aligned.entry.tsMs, px: 0 },
      exit: { tsMs: aligned.entry.tsMs, px: 0, reason: 'invalid_entry_candle' },
      pnl: {
        grossReturnPct: 0,
        netReturnPct: 0,
        feesUsd: 0,
        slippageUsd: 0,
      },
      diagnostics: {
        candlesUsed: candles.length,
        tradeable: true,
        skippedReason: 'invalid_entry_candle',
      },
    }));
  }

  // Slice candles from entry point forward
  const simulationCandles = candles.slice(entryCandleIndex);

  // Entry point (use candle open for simplicity)
  const entryPoint = {
    tsMs: aligned.entry.tsMs,
    px: entryCandle.open,
  };

  // Call simulation engine (single entrypoint)
  const simResults = await runOverlaySimulation({
    candles: simulationCandles,
    entry: entryPoint,
    overlays: params.overlays,
    fees: params.fee,
    position: params.position,
  });

  // Map OverlaySimulationResult to CallBacktestResult
  return simResults.map((simResult) => ({
    call: aligned.call,
    overlay: simResult.overlay,
    entry: simResult.entry,
    exit: { tsMs: simResult.exit.tsMs, px: simResult.exit.px, reason: simResult.exitReason },
    pnl: simResult.pnl,
    diagnostics: simResult.diagnostics,
  }));
}
