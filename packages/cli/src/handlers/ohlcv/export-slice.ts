/**
 * CLI Handler for OHLCV Slice Export
 *
 * Pure handler that calls the OHLCV package handler.
 * Depends on ports only (via CommandContext).
 */

import type { CommandContext } from '../../core/command-context.js';
import { exportOhlcvSliceHandler, type ExportOhlcvSliceArgs } from '@quantbot/ohlcv';

/**
 * Export OHLCV slice via CLI
 *
 * @param args - Export arguments
 * @param ctx - Command context
 * @returns Export result
 */
export async function exportOhlcvSliceCLIHandler(args: ExportOhlcvSliceArgs, ctx: CommandContext) {
  const artifactStore = ctx.services.artifactStore();
  return await exportOhlcvSliceHandler(args, artifactStore);
}
