import type { WorkflowContextWithPorts } from '../context/workflowContextWithPorts.js';
import { createTokenAddress } from '@quantbot/core';

export type IngestOhlcvWorkflowInput = {
  mint?: string;
  from?: string;
  to?: string;
  interval: '15s' | '1m' | '5m' | '15m' | '1H' | '4H' | '1D';
  duckdbPath: string;
  chain?: 'solana' | 'evm';
};

export type IngestOhlcvWorkflowOutput = {
  ok: boolean;
  summary: Record<string, unknown>;
  errors?: Array<{ message: string; context?: Record<string, unknown> }>;
};

/**
 * Ported OHLCV ingestion workflow
 *
 * This is the first "ported" workflow wrapper that uses ctx.ports.*
 * and never touches raw clients directly.
 *
 * This wrapper demonstrates:
 * - ctx.ports.telemetry works (emitEvent, emitMetric)
 * - ctx.ports.clock works properly (nowMs)
 * - ctx.ports.marketData works (fetchOhlcv) - NO raw BirdeyeClient calls
 *
 * This proves the ports pattern works end-to-end.
 */
export async function ingestOhlcvWorkflowPorted(
  input: IngestOhlcvWorkflowInput,
  ctx: WorkflowContextWithPorts
): Promise<IngestOhlcvWorkflowOutput> {
  const start = ctx.ports.clock.nowMs();

  ctx.ports.telemetry.emitEvent({
    name: 'ohlcv.ingest.started',
    level: 'info',
    message: 'OHLCV ingestion started',
    context: { interval: input.interval, duckdbPath: input.duckdbPath, mint: input.mint },
  });

  try {
    // If a specific mint is provided, fetch candles for it using ctx.ports.marketData
    let candlesFetched = 0;
    const errors: Array<{ message: string; context?: Record<string, unknown> }> = [];

    if (input.mint) {
      try {
        // Use ctx.ports.marketData - NO raw BirdeyeClient calls!
        const tokenAddress = createTokenAddress(input.mint);
        const chain = input.chain === 'evm' ? 'ethereum' : input.chain ?? 'solana';
        
        // Convert ISO strings to UNIX timestamps (seconds)
        // Use ctx.ports.clock instead of Date.now() for determinism
        const nowUnix = Math.floor(ctx.ports.clock.nowMs() / 1000);
        const fromUnix = input.from ? Math.floor(new Date(input.from).getTime() / 1000) : nowUnix - 3600;
        const toUnix = input.to ? Math.floor(new Date(input.to).getTime() / 1000) : nowUnix;

        const candles = await ctx.ports.marketData.fetchOhlcv({
          tokenAddress,
          chain: chain as 'solana' | 'ethereum' | 'base' | 'bsc',
          interval: input.interval,
          from: fromUnix,
          to: toUnix,
        });

        candlesFetched = candles.length;

        ctx.ports.telemetry.emitEvent({
          name: 'ohlcv.ingest.candles_fetched',
          level: 'info',
          message: `Fetched ${candles.length} candles for ${input.mint}`,
          context: { mint: input.mint, candleCount: candles.length, interval: input.interval },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          message: `Failed to fetch candles for ${input.mint}: ${errorMessage}`,
          context: { mint: input.mint },
        });

        ctx.ports.telemetry.emitEvent({
          name: 'ohlcv.ingest.fetch_failed',
          level: 'error',
          message: `Failed to fetch candles for ${input.mint}`,
          context: { mint: input.mint, error: errorMessage },
          error: error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : undefined,
        });
      }
    }

    const out: IngestOhlcvWorkflowOutput = {
      ok: errors.length === 0,
      summary: {
        candlesFetched,
        errors: errors.length,
        interval: input.interval,
        duckdbPath: input.duckdbPath,
        mint: input.mint,
      },
      errors: errors.length > 0 ? errors : undefined,
    };

    const elapsed = ctx.ports.clock.nowMs() - start;
    ctx.ports.telemetry.emitMetric({
      name: 'ohlcv_ingest_elapsed_ms',
      type: 'gauge',
      value: elapsed,
      labels: { interval: input.interval },
    });
    ctx.ports.telemetry.emitMetric({
      name: 'ohlcv_ingest_candles_fetched',
      type: 'counter',
      value: candlesFetched,
      labels: { interval: input.interval },
    });
    ctx.ports.telemetry.emitEvent({
      name: 'ohlcv.ingest.completed',
      level: 'info',
      message: 'OHLCV ingestion completed',
      context: { ok: out.ok, elapsedMs: elapsed, candlesFetched },
    });

    return out;
  } catch (err) {
    const elapsed = ctx.ports.clock.nowMs() - start;
    ctx.ports.telemetry.emitMetric({
      name: 'ohlcv_ingest_elapsed_ms',
      type: 'gauge',
      value: elapsed,
      labels: { interval: input.interval, error: 'true' },
    });
    ctx.ports.telemetry.emitEvent({
      name: 'ohlcv.ingest.failed',
      level: 'error',
      message: 'OHLCV ingestion failed',
      context: { error: err instanceof Error ? err.message : String(err) },
      error: err instanceof Error
        ? {
            message: err.message,
            stack: err.stack,
          }
        : undefined,
    });

    return {
      ok: false,
      summary: { ok: false },
      errors: [{ message: err instanceof Error ? err.message : String(err) }],
    };
  }
}

