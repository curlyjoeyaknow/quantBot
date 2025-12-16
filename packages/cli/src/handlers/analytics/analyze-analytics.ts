/**
 * Handler for analytics analyze command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import { DateTime } from 'luxon';
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { analyzeSchema } from '../../commands/analytics.js';

/**
 * Input arguments (already validated by Zod)
 */
export type AnalyzeAnalyticsArgs = z.infer<typeof analyzeSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function analyzeAnalyticsHandler(
  args: AnalyzeAnalyticsArgs,
  ctx: CommandContext
) {
  const engine = ctx.services.analyticsEngine();

  return engine.analyzeCalls({
    callerNames: args.caller ? [args.caller] : undefined,
    from: args.from ? DateTime.fromISO(args.from).toJSDate() : undefined,
    to: args.to ? DateTime.fromISO(args.to).toJSDate() : undefined,
  });
}

