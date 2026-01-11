/**
 * Caller Analysis Handler
 *
 * Handler for Python-based caller analysis and scoring.
 * Wraps CallerAnalysisService (run_caller_analysis.py).
 *
 * Pure handler - no console.log, no process.exit, no try/catch.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { z as zod } from 'zod';

// =============================================================================
// Zod Schema
// =============================================================================

export const callerAnalysisSchema = zod.object({
  duckdb: zod.string(),
  runId: zod.string().optional(),
  from: zod.string().optional(), // YYYY-MM-DD
  to: zod.string().optional(), // YYYY-MM-DD
  minTrades: zod.number().int().positive().default(10),
  top: zod.number().int().positive().default(50),
  score: zod.boolean().default(false), // Enable v2 scoring
});

export type CallerAnalysisArgs = z.infer<typeof callerAnalysisSchema>;

// =============================================================================
// Handler
// =============================================================================

/**
 * Analyze callers from baseline backtest results
 *
 * @param args - Validated command arguments
 * @param ctx - Command context with services
 * @returns Caller analysis result
 */
export async function callerAnalysisHandler(args: CallerAnalysisArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  const service = ctx.services.callerAnalysis();

  const config = {
    duckdb: args.duckdb,
    run_id: args.runId,
    from: args.from,
    to: args.to,
    min_trades: args.minTrades,
    top: args.top,
    format: 'json' as const,
  };

  // Choose analysis or scoring
  const result = args.score
    ? await service.scoreCallers(config)
    : await service.analyzeCallers(config);

  if (!result.success) {
    throw new Error('Caller analysis failed');
  }

  return {
    success: true,
    run_id: result.run_id,
    total_callers: result.total_callers,
    callers: result.callers,
    scored_callers: result.scored_callers,
  };
}

