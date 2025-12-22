/**
 * Handler for analytics metrics command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { type MetricsArgs } from '../../command-defs/analytics.js';

/**
 * Input arguments (already validated by Zod)
 */
export type MetricsAnalyticsArgs = MetricsArgs;

/**
 * Handler function: pure use-case orchestration
 * Calculates period metrics for calls using the analytics engine
 */
export async function metricsAnalyticsHandler(
  args: MetricsAnalyticsArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const engine = ctx.services.analyticsEngine();

  const result = await engine.analyzeCalls({
    callerNames: args.caller ? [args.caller] : undefined,
    from: args.from ? DateTime.fromISO(args.from).toJSDate() : undefined,
    to: args.to ? DateTime.fromISO(args.to).toJSDate() : undefined,
    enrichWithAth: true, // Include ATH metrics
  });

  return {
    totalCalls: result.metadata.totalCalls,
    processedCalls: result.metadata.processedCalls,
    enrichedCalls: result.metadata.enrichedCalls,
    processingTimeMs: result.metadata.processingTimeMs,
    callerMetrics: result.callerMetrics,
    systemMetrics: result.systemMetrics,
    athDistribution: result.athDistribution,
  };
}
