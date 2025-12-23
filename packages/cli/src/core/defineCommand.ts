/**
 * Standard Command Wrapper
 *
 * Provides a mechanical pattern for CLI commands that makes it hard to screw up:
 * - Commander owns flags & parsing
 * - Wrapper owns: canonical option shape (camelCase), value coercion, schema validation,
 *   error formatting, handler invocation
 *
 * CRITICAL: Uses commandDef.schema from registry as single source of truth for validation.
 * This ensures no schema duplication or divergence between defineCommand and registry.
 *
 * Invariant: Normalization never renames keys. Ever.
 */

import type { Command } from 'commander';
import { executeValidated } from './execute.js';
import { commandRegistry } from './command-registry.js';
import { NotFoundError, ValidationError } from '@quantbot/utils';
import { validateAndCoerceArgs } from './validation-pipeline.js';

type CoerceFn<TIn, TOut> = (raw: TIn) => TOut;

export type DefineCommandArgs<TRawOpts> = {
  name: string;
  packageName: string;
  // Merge Commander arguments into options before coercion
  argsToOpts?: (args: unknown[], rawOpts: TRawOpts) => TRawOpts;
  // Takes commander-parsed options and returns *camelCase* validated options.
  // Use this for value coercion only (JSON/numbers/arrays), NOT key renaming.
  coerce?: CoerceFn<TRawOpts, TRawOpts>;
  // DEPRECATED: validate function is ignored - commandDef.schema from registry is used instead
  // Kept for backward compatibility during migration, but will be removed
  validate?: (opts: TRawOpts) => unknown;
  onError?: (e: unknown) => never;
};

/**
 * Standard command wiring:
 * - Commander parses flags -> camelCase properties
 * - Optional coerce() for value parsing only (JSON/numbers)
 * - Validates using commandDef.schema from registry (SINGLE SOURCE OF TRUTH)
 * - Uses executeValidated() which handles context, formatting, artifacts, etc.
 *
 * Invariant: we do NOT rename keys. Ever.
 * Invariant: Validation uses commandDef.schema from registry, not a separate validate function.
 */
export function defineCommand<TRawOpts extends Record<string, unknown>>(
  cmd: Command,
  args: DefineCommandArgs<TRawOpts>
): Command {
  cmd.name(args.name);

  cmd.action(async (...commanderArgs: unknown[]) => {
    try {
      // Get command definition from registry FIRST (before validation)
      const commandDef = commandRegistry.getCommand(args.packageName, args.name);
      if (!commandDef) {
        throw new NotFoundError('Command', `${args.packageName}.${args.name}`);
      }

      // Commander gives camelCase keys already
      const rawOpts = cmd.opts() as TRawOpts;

      // Merge arguments into options if argsToOpts provided
      const merged = args.argsToOpts ? args.argsToOpts(commanderArgs, rawOpts) : rawOpts;

      // Coerce values (JSON/numbers/arrays) - but never rename keys
      const coerced = args.coerce ? args.coerce(merged) : merged;

      // CRITICAL: Use commandDef.schema from registry as single source of truth
      // This ensures no schema duplication or divergence
      // Legacy validate function is deprecated - we now use registry schema exclusively
      if (args.validate) {
        console.warn(
          `DEPRECATED: defineCommand validate function for ${args.packageName}.${args.name} is ignored. ` +
            `Using commandDef.schema from registry instead. Please remove validate parameter.`
        );
      }
      const validated = validateAndCoerceArgs(
        commandDef.schema,
        coerced as Record<string, unknown>
      );

      // Use executeValidated() since we've already validated here
      // This avoids double validation in execute()
      await executeValidated(commandDef, validated as Record<string, unknown>);
    } catch (e) {
      if (args.onError) {
        args.onError(e);
      }
      throw e;
    }
  });

  return cmd;
}
