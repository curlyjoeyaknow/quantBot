import type { CommandContext } from '../../core/command-context.js';
import { type ErrorsObservabilityArgs } from '../../command-defs/observability.js';
import { getErrorStats } from '@quantbot/observability';

export async function errorsObservabilityHandler(
  args: ErrorsObservabilityArgs,
  _ctx: CommandContext
) {
  // Default to last 24 hours if no dates provided
  const to = args.to ? new Date(args.to) : new Date();
  const from = args.from ? new Date(args.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  return await getErrorStats({ from, to });
}
