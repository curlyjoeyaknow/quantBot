/**
 * CLI Composition Root for Error Observability
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Use Date.now() (via ClockPort adapter)
 * - Do I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import { type ErrorsObservabilityArgs } from '../../command-defs/observability.js';
import { getErrorStats } from '@quantbot/observability';
import type { ClockPort } from '@quantbot/core';

/**
 * System clock adapter (composition root - allowed to use Date.now())
 */
const systemClock: ClockPort = {
  nowMs: () => Date.now(),
};

/**
 * CLI handler for error observability
 *
 * This function can:
 * - Use Date.now() via ClockPort adapter ✅
 * - Do I/O ✅
 */
export async function errorsObservabilityHandler(
  args: ErrorsObservabilityArgs,
  _ctx: CommandContext
) {
  // Use ClockPort adapter instead of Date.now() directly
  const now = systemClock.nowMs();
  const to = args.to ? new Date(args.to) : new Date(now);
  const from = args.from ? new Date(args.from) : new Date(now - 24 * 60 * 60 * 1000);

  return await getErrorStats({ from, to });
}
