/**
 * Generate Patch Worklist Handler
 *
 * Generates a patch worklist by calling the Python script that calculates fetch windows.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/utils';
import { getPythonEngine } from '@quantbot/utils';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

export const generatePatchWorklistSchema = z.object({
  duckdb: z.string().min(1, 'DuckDB path is required'),
  clickhouseContainer: z.string().default('quantbot-clickhouse-1'),
  from: z.string().optional(),
  to: z.string().optional(),
  side: z.enum(['buy', 'sell']).default('buy'),
  chain: z.string().optional(),
  outputExisting: z.string().default('patch-worklist-existing.json'),
  outputNew: z.string().default('patch-worklist-new.json'),
  outputAll: z.string().optional(),
});

export type GeneratePatchWorklistArgs = z.infer<typeof generatePatchWorklistSchema>;

/**
 * Generate patch worklist
 */
export async function generatePatchWorklistHandler(
  args: GeneratePatchWorklistArgs,
  ctx: CommandContext
) {
  const duckdbPath = resolve(process.cwd(), args.duckdb);
  const outputExistingPath = resolve(process.cwd(), args.outputExisting);
  const outputNewPath = resolve(process.cwd(), args.outputNew);
  const outputAllPath = args.outputAll ? resolve(process.cwd(), args.outputAll) : undefined;

  logger.info('Generating patch worklist', {
    duckdbPath,
    clickhouseContainer: args.clickhouseContainer,
    from: args.from,
    to: args.to,
    side: args.side,
    chain: args.chain,
    outputExisting: outputExistingPath,
    outputNew: outputNewPath,
    outputAll: outputAllPath,
  });

  // Call Python script to generate worklist
  const pythonEngine = getPythonEngine();
  const scriptPath = resolve(process.cwd(), 'tools/ingestion/ohlcv_patch_worklist.py');

  // Build args as Record for PythonEngine
  // Note: Python script uses kebab-case (--clickhouse-container), not camelCase
  const scriptArgs: Record<string, unknown> = {
    duckdb: duckdbPath,
    'clickhouse-container': args.clickhouseContainer,
    'output-existing': args.outputExisting,
    'output-new': args.outputNew,
  };

  if (args.from) {
    scriptArgs.from = args.from;
  }
  if (args.to) {
    scriptArgs.to = args.to;
  }
  if (args.side) {
    scriptArgs.side = args.side;
  }
  if (args.chain) {
    scriptArgs.chain = args.chain;
  }

  if (args.outputAll) {
    scriptArgs['output-all'] = args.outputAll;
  }

  const result = await pythonEngine.runScript(
    scriptPath,
    scriptArgs,
    z.object({
      summary: z.object({
        totalItems: z.number(),
        totalTokens: z.number(),
        existingItems: z.number(),
        existingTokens: z.number(),
        newItems: z.number(),
        newTokens: z.number(),
      }),
      files: z.object({
        existing: z.string(),
        new: z.string(),
        all: z.string().nullable(),
      }),
    }),
    { cwd: resolve(process.cwd(), 'tools/ingestion') }
  );

  logger.info('Patch worklist generated', {
    outputExisting: outputExistingPath,
    outputNew: outputNewPath,
    outputAll: outputAllPath,
    existingItems: result.summary.existingItems,
    existingTokens: result.summary.existingTokens,
    newItems: result.summary.newItems,
    newTokens: result.summary.newTokens,
    totalItems: result.summary.totalItems,
    totalTokens: result.summary.totalTokens,
  });

  return {
    outputExisting: outputExistingPath,
    outputNew: outputNewPath,
    outputAll: outputAllPath,
    existingItems: result.summary.existingItems,
    existingTokens: result.summary.existingTokens,
    newItems: result.summary.newItems,
    newTokens: result.summary.newTokens,
    totalItems: result.summary.totalItems,
    totalTokens: result.summary.totalTokens,
  };
}
