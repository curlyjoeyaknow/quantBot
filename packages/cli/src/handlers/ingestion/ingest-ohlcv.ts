/**
 * Handler for ingestion ohlcv command
 *
 * Thin adapter: parses args, calls workflow, returns data.
 * NO orchestration logic - that belongs in the workflow.
 *
 * Flow:
 * 1. Parse args → build spec
 * 2. Create workflow context
 * 3. Call workflow
 * 4. Return result (workflow returns JSON-serializable data)
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestOhlcvArgs = z.infer<typeof ohlcvSchema>;

/**
 * Handler function: thin adapter (parse → call workflow → return)
 *
 * Follows workflow contract:
 * - Parse args → spec
 * - Create context
 * - Call workflow
 * - Return structured result (already JSON-serializable from workflow)
 */
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, ctx: CommandContext) {
  // Parse args → build spec
  const duckdbPath = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPath) {
    throw new Error(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.'
    );
  }

  const spec: IngestOhlcvSpec = {
    duckdbPath,
    from: args.from,
    to: args.to,
    side: 'buy', // Default to buy side
    chain: 'solana', // Default chain
    interval: args.interval,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
    errorMode: 'collect', // Collect errors, don't fail fast
    checkCoverage: true,
    rateLimitMs: 100,
    maxRetries: 3,
  };

  // Create workflow context with jobs service
  const workflowContext = createOhlcvIngestionContext({
    ohlcvFetchJob: ctx.services.ohlcvFetchJob(),
  });

  // Call workflow (orchestration happens here)
  const result = await ingestOhlcv(spec, workflowContext);

  // Return result (already JSON-serializable from workflow)
  return result;
}
