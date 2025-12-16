/**
 * Universal Command Executor
 *
 * Handles all the boring universal stuff:
 * - Normalize options
 * - Parse arguments (Zod validation)
 * - Initialize context (storage)
 * - Call handler
 * - Format output
 * - Error handling
 */

import { parseArguments, normalizeOptions } from './argument-parser.js';
import { formatOutput } from './output-formatter.js';
import { handleError } from './error-handler.js';
import { CommandContext } from './command-context.js';
import type { CommandDefinition } from '../types/index.js';
import type { OutputFormat } from '../types/index.js';

/**
 * Execute a command definition with raw options
 */
export async function execute(
  commandDef: CommandDefinition,
  rawOptions: Record<string, unknown>
): Promise<void> {
  try {
    // 1. Normalize options (handles --flag value and --flag=value)
    const normalized = normalizeOptions(rawOptions);

    // 2. Parse and validate arguments
    const args = parseArguments(commandDef.schema, normalized);

    // 3. Create context and ensure initialization
    const ctx = new CommandContext();
    await ctx.ensureInitialized();

    // 4. Extract format (if present) before calling handler
    // Format is CLI concern, not handler concern
    const format = (args as { format?: OutputFormat }).format ?? 'table';
    const handlerArgs = { ...(args as Record<string, unknown>) };
    // Remove format from handler args if it exists
    if ('format' in handlerArgs) {
      delete (handlerArgs as { format?: OutputFormat }).format;
    }

    // 5. Call handler (pure use-case function)
    const result = await commandDef.handler(handlerArgs, ctx);

    // 6. Format and print output
    const output = formatOutput(result, format);
    console.log(output);
  } catch (error) {
    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

