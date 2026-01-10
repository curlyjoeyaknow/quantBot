/**
 * Standard Command Wrapper
 *
 * Provides a mechanical pattern for CLI commands that makes it hard to screw up:
 * - Commander owns flags & parsing
 * - Wrapper owns: canonical option shape (camelCase), value coercion (pre-validation)
 * - Calls execute() which handles validation, context, formatting, artifacts, error handling
 *
 * CRITICAL: defineCommand() does NOT validate. Validation happens in execute().
 * This ensures a single validation path for all commands, preventing divergence.
 *
 * Invariant: Normalization never renames keys. Ever.
 * Invariant: All validation goes through execute() using commandDef.schema from registry.
 */

import type { Command } from 'commander';
import { execute } from './execute.js';
import { commandRegistry } from './command-registry.js';
import { NotFoundError } from '@quantbot/utils';

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
 * - Optional coerce() for value parsing only (JSON/numbers/arrays)
 * - Calls execute() which handles validation, context, formatting, artifacts, etc.
 *
 * CRITICAL: defineCommand() does NOT validate. Validation happens in execute().
 * This ensures a single validation path for all commands.
 *
 * Invariant: we do NOT rename keys. Ever.
 * Invariant: Validation uses commandDef.schema from registry in execute().
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
      // Note: This is pre-validation coercion only. Actual validation happens in execute().
      const coerced = args.coerce ? args.coerce(merged) : merged;

      // CRITICAL: Do NOT validate here. execute() is the single source of truth for validation.
      // This ensures all commands go through the same validation path, preventing divergence.
      if (args.validate) {
        console.warn(
          `DEPRECATED: defineCommand validate function for ${args.packageName}.${args.name} is ignored. ` +
            `Validation happens in execute() using commandDef.schema from registry. Please remove validate parameter.`
        );
      }

      // Call execute() which handles validation, context, formatting, artifacts, etc.
      // This is the SINGLE validation path for all commands.
      await execute(commandDef, coerced as Record<string, unknown>);
    } catch (e) {
      if (args.onError) {
        args.onError(e);
      }
      throw e;
    }
  });

  return cmd;
}
