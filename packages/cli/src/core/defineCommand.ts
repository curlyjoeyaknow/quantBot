/**
 * Standard Command Wrapper
 *
 * Provides a mechanical pattern for CLI commands that makes it hard to screw up:
 * - Commander owns flags & parsing
 * - Wrapper owns: canonical option shape (camelCase), value coercion, schema validation,
 *   error formatting, handler invocation
 *
 * Invariant: Normalization never renames keys. Ever.
 */

import type { Command } from 'commander';
import { executeValidated } from './execute.js';
import { commandRegistry } from './command-registry.js';
import { NotFoundError } from '@quantbot/utils';

type CoerceFn<TIn, TOut> = (raw: TIn) => TOut;

export type DefineCommandArgs<TRawOpts, TOpts> = {
  name: string;
  packageName: string;
  // Merge Commander arguments into options before coercion
  argsToOpts?: (args: unknown[], rawOpts: TRawOpts) => TRawOpts;
  // Takes commander-parsed options and returns *camelCase* validated options.
  // Use this for value coercion only (JSON/numbers/arrays), NOT key renaming.
  coerce?: CoerceFn<TRawOpts, TRawOpts>;
  validate: (opts: TRawOpts) => TOpts; // zod/valibot parse wrapper
  onError?: (e: unknown) => never;
};

/**
 * Standard command wiring:
 * - Commander parses flags -> camelCase properties
 * - Optional coerce() for value parsing only (JSON/numbers)
 * - validate() produces typed options
 * - Uses execute() which handles context, formatting, artifacts, etc.
 *
 * Invariant: we do NOT rename keys. Ever.
 */
export function defineCommand<TRawOpts extends Record<string, unknown>, TOpts>(
  cmd: Command,
  args: DefineCommandArgs<TRawOpts, TOpts>
): Command {
  cmd.name(args.name);

  cmd.action(async (...commanderArgs: unknown[]) => {
    try {
      // Commander gives camelCase keys already
      const rawOpts = cmd.opts() as TRawOpts;

      // Merge arguments into options if argsToOpts provided
      const merged = args.argsToOpts ? args.argsToOpts(commanderArgs, rawOpts) : rawOpts;

      // Coerce values (JSON/numbers/arrays) - but never rename keys
      const coerced = args.coerce ? args.coerce(merged) : merged;

      // Validate with schema (single source of truth for validation)
      const opts = args.validate(coerced);

      // Get command definition from registry
      const commandDef = commandRegistry.getCommand(args.packageName, args.name);
      if (!commandDef) {
        throw new NotFoundError('Command', `${args.packageName}.${args.name}`);
      }

      // Use executeValidated() since we've already validated here
      // This avoids double validation in execute()
      await executeValidated(commandDef, opts as Record<string, unknown>);
    } catch (e) {
      if (args.onError) {
        args.onError(e);
      }
      throw e;
    }
  });

  return cmd;
}
