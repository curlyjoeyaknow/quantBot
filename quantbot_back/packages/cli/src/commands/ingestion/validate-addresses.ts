/**
 * CLI Composition Root for validate-addresses command
 *
 * This is a composition root - it wires adapters and calls the pure handler.
 * All I/O, env reads, and adapter wiring happens here.
 */

import type { CommandContext } from '../../core/command-context.js';
import { validateAddressesHandler as pureHandler } from '../../pure/ingestion/validate-addresses.js';
import type { ValidateAddressesArgs } from '../../pure/ingestion/validate-addresses.js';

// Re-export types for backward compatibility
export type {
  ValidateAddressesArgs,
  ValidateAddressesResult,
} from '../../pure/ingestion/validate-addresses.js';

/**
 * CLI composition root for validate-addresses
 *
 * This function can:
 * - Read process.env ✅
 * - Wire adapters ✅
 * - Do I/O ✅
 *
 * It calls the pure handler which does the actual work.
 */
export async function validateAddressesHandler(args: ValidateAddressesArgs, ctx: CommandContext) {
  // Call pure handler (no I/O, no env, no time globals)
  return await pureHandler(args, ctx);
}
