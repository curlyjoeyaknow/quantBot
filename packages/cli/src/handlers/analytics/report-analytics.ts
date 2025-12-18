/**
 * Handler for analytics report command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { type ReportArgs } from '../../command-defs/analytics.js';

/**
 * Input arguments (already validated by Zod)
 */
export type ReportAnalyticsArgs = ReportArgs;

/**
 * Handler function: pure use-case orchestration
 * Generates a comprehensive analytics report using the analytics engine
 */
export async function reportAnalyticsHandler(
  args: ReportAnalyticsArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const engine = ctx.services.analyticsEngine();

  const result = await engine.analyzeCalls({
    callerNames: args.caller ? [args.caller] : undefined,
    from: args.from ? DateTime.fromISO(args.from).toJSDate() : undefined,
    to: args.to ? DateTime.fromISO(args.to).toJSDate() : undefined,
    enrichWithAth: true, // Include ATH metrics for report
  });

  // Return dashboard summary for report
  return {
    generatedAt: result.dashboard.generatedAt,
    system: result.dashboard.system,
    topCallers: result.dashboard.topCallers,
    athDistribution: result.dashboard.athDistribution,
    recentCallsCount: result.dashboard.recentCalls.length,
    metadata: {
      totalCalls: result.metadata.totalCalls,
      processedCalls: result.metadata.processedCalls,
      enrichedCalls: result.metadata.enrichedCalls,
      processingTimeMs: result.metadata.processingTimeMs,
    },
  };
}
