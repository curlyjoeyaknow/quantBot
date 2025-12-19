/**
 * Handler for DuckDB-based statistical analysis.
 * Uses AnalyticsService to run analysis.
 */

import type { CommandContext } from '../../core/command-context.js';
import { ValidationError } from '@quantbot/utils';
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

  // Build config
  const config: AnalyticsConfig = {
    duckdb: args.duckdb,
    caller: args.caller,
    mint: args.mint,
    correlation: !!args.correlation, // Convert object to boolean
  };

  return await service.runAnalysis(config);
}
