import type { CommandContext } from '../../core/command-context.js';
import { type MetricsArgs } from '../../command-defs/analytics.js';

/**
 * Stub handler for analytics metrics command.
 * TODO: Implement metrics calculation logic.
 */
export async function metricsAnalyticsHandler(
  _args: MetricsArgs,
  _ctx: CommandContext
): Promise<Record<string, unknown>> {
  return {
    message: 'Metrics calculation not yet implemented',
    note: 'This command will calculate period metrics for calls',
  };
}
