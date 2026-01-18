/**
 * Handler for ohlcv query command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import { DateTime } from 'luxon';
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { querySchema } from '../../commands/ohlcv.js';
import { validateMintAddress } from '../../core/argument-parser.js';
import { ValidationError } from '@quantbot/infra/utils';

/**
 * Input arguments (already validated by Zod)
 */
export type QueryOhlcvArgs = z.infer<typeof querySchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function queryOhlcvHandler(args: QueryOhlcvArgs, ctx: CommandContext) {
  const repository = ctx.services.ohlcvRepository();

  // Validate and preserve mint address case
  const mintAddress = validateMintAddress(args.mint);

  // Parse dates
  const fromDate = DateTime.fromISO(args.from);
  const toDate = DateTime.fromISO(args.to);

  if (!fromDate.isValid) {
    throw new ValidationError(`Invalid from date: ${args.from}`, { from: args.from });
  }
  if (!toDate.isValid) {
    throw new ValidationError(`Invalid to date: ${args.to}`, { to: args.to });
  }

  if (fromDate >= toDate) {
    throw new ValidationError('From date must be before to date', {
      from: args.from,
      to: args.to,
    });
  }

  return repository.getCandles(mintAddress, args.chain, args.interval, {
    from: fromDate,
    to: toDate,
  });
}
