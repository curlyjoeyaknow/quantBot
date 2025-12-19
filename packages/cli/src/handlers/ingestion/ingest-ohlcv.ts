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
import { resolve } from 'path';
import { ConfigurationError } from '@quantbot/utils';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';
import { OhlcvBirdeyeFetch } from '@quantbot/jobs';

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
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, _ctx: CommandContext) {
  // Parse args → build spec
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdb',
      { envVar: 'DUCKDB_PATH' }
    );
  }
  // Convert relative paths to absolute paths (Python scripts run from different working directories)
  const duckdbPath = resolve(process.cwd(), duckdbPathRaw);

  // Map CLI interval to workflow interval format
  // CLI: '1m' | '5m' | '15m' | '1h'
  // Workflow: '15s' | '1m' | '5m' | '1H'
  const intervalMap: Record<string, '15s' | '1m' | '5m' | '1H'> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '5m', // Map 15m to 5m (closest available)
    '1h': '1H',
  };
  const workflowInterval = intervalMap[args.interval] || '1m';

  const spec: IngestOhlcvSpec = {
    duckdbPath,
    from: args.from,
    to: args.to,
    side: 'buy', // Default to buy side
    chain: 'solana', // Default chain
    interval: workflowInterval,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
    errorMode: 'collect', // Collect errors, don't fail fast
    checkCoverage: true,
    rateLimitMs: 100,
    maxRetries: 3,
  };

  // Create workflow context with Birdeye fetch service
  // Note: The workflow handles storage (ClickHouse) and metadata (DuckDB) internally
  const ohlcvBirdeyeFetch = new OhlcvBirdeyeFetch({
    rateLimitMs: spec.rateLimitMs,
    maxRetries: spec.maxRetries,
    checkCoverage: spec.checkCoverage,
  });
  const workflowContext = createOhlcvIngestionContext({
    ohlcvBirdeyeFetch,
  });

  // Call workflow (orchestration happens here)
  const result = await ingestOhlcv(spec, workflowContext);

  // Return result (already JSON-serializable from workflow)
  return result;
}
