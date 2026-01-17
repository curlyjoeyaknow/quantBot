/**
 * Call Evaluation Workflow - Orchestrate alignment + backtest + scoring
 *
 * This is the orchestration entrypoint that uses ctx.ports.marketData.fetchOhlcv():
 * - Fetches candles for each call
 * - Aligns calls to OHLCV windows
 * - Backtests with multiple overlays
 * - Aggregates results by caller
 *
 * Key separation:
 * - core: schemas + alignment + backtest (pure)
 * - workflow: fetching candles + emitting telemetry + persistence of outputs
 */

import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/infra/utils';

import type { CallSignal, Chain, TokenAddress } from '@quantbot/core';
import type { MarketDataPort } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';
import { alignCallToOhlcvWindow, findEntryCandleIndex, type AlignedCall } from './align.js';
import { evaluateCallOverlays, type BacktestParams, type CallBacktestResult } from './backtest.js';
import type { AlignParams } from './align.js';
import type { ExitOverlay } from './backtest.js';

/**
 * Extended workflow context with ports for market data
 */
export type WorkflowContextWithPorts = {
  ports: {
    marketData: MarketDataPort;
  };
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };
};

/**
 * Evaluate calls request
 */
export type EvaluateCallsRequest = {
  calls: CallSignal[];
  align: AlignParams;
  backtest: BacktestParams;
};

/**
 * Summary by caller
 */
export type CallerSummary = {
  callerFromId: string;
  callerName: string;
  calls: number;
  tradeableCalls: number;
  medianNetReturnPct: number;
  winRate: number;
  maxDrawdownPct?: number;
  bestOverlay?: ExitOverlay;
};

/**
 * Evaluate calls output (JSON-serializable)
 */
export type EvaluateCallsOutput = {
  results: CallBacktestResult[];
  summaryByCaller: CallerSummary[];
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
};

/**
 * Evaluate calls workflow
 *
 * Orchestrates:
 * 1. Align each call to OHLCV window
 * 2. Fetch candles via ctx.ports.marketData.fetchOhlcv()
 * 3. Find entry candle index
 * 4. Backtest with overlays
 * 5. Aggregate results by caller
 *
 * @param req - Evaluation request (calls, alignment params, backtest params)
 * @param ctx - Workflow context with ports
 * @returns Evaluation results with per-call and per-caller summaries
 */
export async function evaluateCallsWorkflow(
  req: EvaluateCallsRequest,
  ctx: WorkflowContextWithPorts
): Promise<EvaluateCallsOutput> {
  const startedAt = DateTime.utc();
  const startedAtISO = startedAt.toISO()!;

  ctx.logger.info('Starting call evaluation workflow', {
    callCount: req.calls.length,
    overlayCount: req.backtest.overlays.length,
  });

  // 1. Align all calls
  const alignedCalls: AlignedCall[] = req.calls.map((call) =>
    alignCallToOhlcvWindow(call, req.align)
  );

  // 2. Fetch candles for each call and backtest
  const allResults: CallBacktestResult[] = [];

  for (let i = 0; i < alignedCalls.length; i++) {
    const aligned = alignedCalls[i];
    if (!aligned) continue;

    const call = aligned.call;

    // Skip if not tradeable
    if (!aligned.eligibility.tradeable) {
      ctx.logger.debug?.('Skipping non-tradeable call', {
        caller: call.caller.displayName,
        token: call.token.address,
        reason: aligned.eligibility.reason,
      });
      continue;
    }

    try {
      // Fetch candles via port
      // Map chain from CallSignal format to MarketDataPort format
      const chainMap: Record<CallSignal['token']['chain'], string> = {
        sol: 'solana',
        eth: 'ethereum',
        bsc: 'bsc',
        base: 'base',
        arb: 'evm', // Arbitrum uses EVM
        op: 'evm', // Optimism uses EVM
        unknown: 'solana', // Default fallback
      };
      const mappedChain = chainMap[call.token.chain] || 'solana';

      // Map interval from align format to MarketDataPort format
      const intervalMap: Record<
        AlignParams['interval'],
        '15s' | '1m' | '5m' | '15m' | '1H' | '4H' | '1D'
      > = {
        '1s': '15s', // Closest available
        '1m': '1m',
        '5m': '5m',
        '15m': '15m',
        '1h': '1H',
      };
      const mappedInterval = intervalMap[req.align.interval] || '5m';

      // CRITICAL: Verify address is not truncated before creating TokenAddress
      if (call.token.address.length < 32) {
        ctx.logger.error('Address is truncated in evaluate workflow', {
          tokenAddress: call.token.address,
          length: call.token.address.length,
          expectedMin: 32,
          caller: call.caller.displayName,
        });
        throw new ValidationError('Address is truncated in evaluate', {
          address: call.token.address,
          length: call.token.address.length,
          expectedMin: 32,
          caller: call.caller.displayName,
        });
      }

      // Convert string address to TokenAddress (for EVM addresses, this will fail validation)
      // For now, we'll use a type assertion since CallSignal supports EVM addresses
      // TODO: Consider making TokenAddress support both Solana and EVM addresses
      let tokenAddress: TokenAddress;
      try {
        tokenAddress = createTokenAddress(call.token.address);
      } catch (error) {
        // EVM addresses are shorter, so we'll use type assertion as fallback
        // But log if it's a Solana address that's too short
        if (call.token.address.length < 32) {
          ctx.logger.error('createTokenAddress failed - address too short', {
            tokenAddress: call.token.address,
            length: call.token.address.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        tokenAddress = call.token.address as TokenAddress;
      }

      const candles = await ctx.ports.marketData.fetchOhlcv({
        tokenAddress,
        chain: mappedChain as Chain,
        interval: mappedInterval,
        from: Math.floor(aligned.window.fromMs / 1000),
        to: Math.floor(aligned.window.toMs / 1000),
      });

      if (candles.length === 0) {
        ctx.logger.warn('No candles fetched for call', {
          caller: call.caller.displayName,
          token: call.token.address,
        });
        continue;
      }

      // Find entry candle index
      const alignedWithIndex = findEntryCandleIndex(aligned, candles);

      // Evaluate overlays using @quantbot/simulation
      const results = await evaluateCallOverlays(alignedWithIndex, candles, req.backtest);
      allResults.push(...results);

      ctx.logger.debug?.('Backtested call', {
        caller: call.caller.displayName,
        token: call.token.address,
        resultsCount: results.length,
      });
    } catch (error) {
      ctx.logger.error('Failed to evaluate call', {
        caller: call.caller.displayName,
        token: call.token.address,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with next call
    }
  }

  // 3. Aggregate results by caller
  const summaryByCaller = aggregateByCaller(allResults, req.backtest.overlays);

  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt).as('milliseconds');

  ctx.logger.info('Completed call evaluation workflow', {
    resultsCount: allResults.length,
    callerCount: summaryByCaller.length,
    durationMs,
  });

  return {
    results: allResults,
    summaryByCaller,
    startedAtISO,
    completedAtISO,
    durationMs,
  };
}

/**
 * Aggregate results by caller
 */
function aggregateByCaller(
  results: CallBacktestResult[],
  overlays: ExitOverlay[]
): CallerSummary[] {
  // Group by caller
  const byCaller = new Map<string, CallBacktestResult[]>();

  for (const result of results) {
    const callerId = result.call.caller.fromId;
    const existing = byCaller.get(callerId) || [];
    existing.push(result);
    byCaller.set(callerId, existing);
  }

  // Calculate summary for each caller
  const summaries: CallerSummary[] = [];

  for (const [callerId, callerResults] of byCaller.entries()) {
    if (callerResults.length === 0) continue;

    const firstResult = callerResults[0];
    if (!firstResult) continue;

    const callerName = firstResult.call.caller.displayName;

    // Count unique calls (dedupe by call.tsMs)
    const uniqueCalls = new Set(callerResults.map((r) => r.call.tsMs));
    const calls = uniqueCalls.size;

    // Count tradeable calls
    const tradeableCalls = callerResults.filter((r) => r.diagnostics.tradeable).length;

    // Calculate median net return
    const netReturns = callerResults
      .filter((r) => r.diagnostics.tradeable && !r.diagnostics.skippedReason)
      .map((r) => r.pnl.netReturnPct)
      .sort((a, b) => a - b);

    const medianNetReturnPct =
      netReturns.length > 0 ? (netReturns[Math.floor(netReturns.length / 2)] ?? 0) : 0;

    // Calculate win rate
    const wins = netReturns.filter((r) => r > 0).length;
    const winRate = netReturns.length > 0 ? wins / netReturns.length : 0;

    // Find best overlay (highest median return)
    let bestOverlay: ExitOverlay | undefined;
    let bestMedian = -Infinity;

    for (const overlay of overlays) {
      const overlayResults = callerResults.filter(
        (r) => JSON.stringify(r.overlay) === JSON.stringify(overlay)
      );
      if (overlayResults.length === 0) continue;

      const overlayReturns = overlayResults
        .filter((r) => r.diagnostics.tradeable && !r.diagnostics.skippedReason)
        .map((r) => r.pnl.netReturnPct)
        .sort((a, b) => a - b);

      if (overlayReturns.length === 0) continue;

      const overlayMedian = overlayReturns[Math.floor(overlayReturns.length / 2)];
      if (overlayMedian !== undefined && overlayMedian > bestMedian) {
        bestMedian = overlayMedian;
        bestOverlay = overlay;
      }
    }

    summaries.push({
      callerFromId: callerId,
      callerName,
      calls,
      tradeableCalls,
      medianNetReturnPct,
      winRate,
      bestOverlay,
    });
  }

  return summaries;
}
