/**
 * Handler for DuckDB-based statistical analysis.
 * Uses AnalyticsService to run analysis.
 */

import type { CommandContext } from '../../core/command-context.js';
import { ValidationError } from '@quantbot/infra/utils';
import { analyzeDuckdbSchema, type AnalyzeDuckdbArgs } from '../../command-defs/analytics.js';
import type { AnalyticsConfig } from '@quantbot/analytics';

// Re-export schema for convenience
export { analyzeDuckdbSchema };
export type { AnalyzeDuckdbArgs };

export async function analyzeDuckdbHandler(args: AnalyzeDuckdbArgs, ctx: CommandContext) {
  const service = ctx.services.analytics();

  // Validate that at least one analysis type is specified
  if (!args.caller && !args.mint && !args.correlation) {
    throw new ValidationError('Must specify --caller, --mint, or --correlation', {
      operation: 'analyze_duckdb',
      provided: {
        caller: !!args.caller,
        mint: !!args.mint,
        correlation: !!args.correlation,
      },
    });
  }

  // Build config - only include properties that are provided
  const config: AnalyticsConfig = {
    duckdb: args.duckdb,
  };

  if (args.caller) {
    config.caller = args.caller;
  }
  if (args.mint) {
    config.mint = args.mint;
  }
  if (args.correlation) {
    config.correlation = true;
  }

  return await service.runAnalysis(config);
}
