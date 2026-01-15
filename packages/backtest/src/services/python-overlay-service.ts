/**
 * Python Overlay Simulation Service
 *
 * Wraps Python overlay simulator for running overlay-based simulations.
 * Python handles computation, TypeScript handles orchestration.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger, AppError, TimeoutError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';

// =============================================================================
// Zod Schemas
// =============================================================================

export const TradePointSchema = z.object({
  ts_ms: z.number(),
  px: z.number(),
});

// ExitOverlay matches TypeScript types (camelCase)
export const ExitOverlaySchema = z.union([
  z.object({ kind: z.literal('time_exit'), holdMs: z.number() }),
  z.object({ kind: z.literal('stop_loss'), stopPct: z.number() }),
  z.object({ kind: z.literal('take_profit'), takePct: z.number() }),
  z.object({ kind: z.literal('trailing_stop'), trailPct: z.number() }),
  z.object({ kind: z.literal('combo'), legs: z.array(z.any()) }),
]);

export const FeeModelSchema = z.object({
  takerFeeBps: z.number(),
  slippageBps: z.number(),
});

export const PositionModelSchema = z.object({
  notionalUsd: z.number(),
});

export const PnlBreakdownSchema = z.object({
  gross_return_pct: z.number(),
  net_return_pct: z.number(),
  fees_usd: z.number(),
  slippage_usd: z.number(),
});

export const SimulationDiagnosticsSchema = z.object({
  candles_used: z.number(),
  tradeable: z.boolean(),
  skipped_reason: z.string().optional(),
});

export const OverlaySimulationResultSchema = z.object({
  overlay: z.any(),
  entry: TradePointSchema,
  exit: TradePointSchema,
  exit_reason: z.string(),
  pnl: PnlBreakdownSchema,
  diagnostics: SimulationDiagnosticsSchema,
});

export type TradePoint = z.infer<typeof TradePointSchema>;
export type ExitOverlay = z.infer<typeof ExitOverlaySchema>;
export type FeeModel = z.infer<typeof FeeModelSchema>;
export type PositionModel = z.infer<typeof PositionModelSchema>;
export type PnlBreakdown = z.infer<typeof PnlBreakdownSchema>;
export type SimulationDiagnostics = z.infer<typeof SimulationDiagnosticsSchema>;
export type OverlaySimulationResult = z.infer<typeof OverlaySimulationResultSchema>;

export interface OverlaySimulationRequest {
  candles: Array<{
    timestamp: number; // Seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  entry: TradePoint;
  overlays: ExitOverlay[];
  fees: FeeModel;
  position: PositionModel;
}

// =============================================================================
// Python Overlay Service
// =============================================================================

/**
 * Python Overlay Simulation Service
 *
 * Wraps Python implementation of overlay simulation.
 * Python handles computation, TypeScript handles orchestration.
 */
export class PythonOverlayService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run overlay simulation
   *
   * @param request - Simulation request with overlays
   * @returns Array of simulation results (one per overlay)
   */
  async runOverlaySimulation(
    request: OverlaySimulationRequest
  ): Promise<OverlaySimulationResult[]> {
    const scriptPath = 'packages/backtest/python/lib/overlay_simulator.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      // Convert overlays to Python format (snake_case)
      const pythonOverlays = request.overlays.map((overlay) => {
        if (overlay.kind === 'time_exit') {
          return { kind: 'time_exit', hold_ms: overlay.holdMs };
        } else if (overlay.kind === 'stop_loss') {
          return { kind: 'stop_loss', stop_pct: overlay.stopPct };
        } else if (overlay.kind === 'take_profit') {
          return { kind: 'take_profit', take_pct: overlay.takePct };
        } else if (overlay.kind === 'trailing_stop') {
          return { kind: 'trailing_stop', trail_pct: overlay.trailPct };
        } else if (overlay.kind === 'combo') {
          return {
            kind: 'combo',
            legs: overlay.legs.map((leg) => {
              if (leg.kind === 'time_exit') {
                return { kind: 'time_exit', hold_ms: leg.holdMs };
              } else if (leg.kind === 'stop_loss') {
                return { kind: 'stop_loss', stop_pct: leg.stopPct };
              } else if (leg.kind === 'take_profit') {
                return { kind: 'take_profit', take_pct: leg.takePct };
              } else if (leg.kind === 'trailing_stop') {
                return { kind: 'trailing_stop', trail_pct: leg.trailPct };
              } else if (leg.kind === 'combo') {
                // Nested combo - recursively convert
                return {
                  kind: 'combo',
                  legs: leg.legs.map((nestedLeg) => {
                    if (nestedLeg.kind === 'time_exit') {
                      return { kind: 'time_exit', hold_ms: nestedLeg.holdMs };
                    } else if (nestedLeg.kind === 'stop_loss') {
                      return { kind: 'stop_loss', stop_pct: nestedLeg.stopPct };
                    } else if (nestedLeg.kind === 'take_profit') {
                      return { kind: 'take_profit', take_pct: nestedLeg.takePct };
                    } else if (nestedLeg.kind === 'trailing_stop') {
                      return { kind: 'trailing_stop', trail_pct: nestedLeg.trailPct };
                    }
                    return nestedLeg;
                  }),
                };
              }
              return leg;
            }),
          };
        }
        return overlay;
      });

      // Call Python script with stdin (JSON input)
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        {
          operation: 'simulate_overlays',
          candles: request.candles,
          entry: {
            ts_ms: request.entry.ts_ms,
            px: request.entry.px,
          },
          overlays: pythonOverlays,
          fees: {
            taker_fee_bps: request.fees.takerFeeBps,
            slippage_bps: request.fees.slippageBps,
          },
          position: {
            notional_usd: request.position.notionalUsd,
          },
        } as unknown as Record<string, unknown>,
        z.array(OverlaySimulationResultSchema),
        {
          timeout: 300000, // 5 minute timeout
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      // Convert Python results (snake_case) to TypeScript format (camelCase)
      return result.map((r: any) => ({
        overlay: r.overlay,
        entry: {
          tsMs: r.entry.ts_ms,
          px: r.entry.px,
        },
        exit: {
          tsMs: r.exit.ts_ms,
          px: r.exit.px,
        },
        exitReason: r.exit_reason,
        pnl: {
          grossReturnPct: r.pnl.gross_return_pct,
          netReturnPct: r.pnl.net_return_pct,
          feesUsd: r.pnl.fees_usd,
          slippageUsd: r.pnl.slippage_usd,
        },
        diagnostics: {
          candlesUsed: r.diagnostics.candles_used,
          tradeable: r.diagnostics.tradeable,
          skippedReason: r.diagnostics.skipped_reason,
        },
      }));
    } catch (error) {
      logger.error('Overlay simulation failed', error as Error);

      // Re-throw AppErrors as-is
      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        `Overlay simulation failed: ${error instanceof Error ? error.message : String(error)}`,
        'OVERLAY_SIMULATION_FAILED',
        500,
        { request }
      );
    }
  }
}
