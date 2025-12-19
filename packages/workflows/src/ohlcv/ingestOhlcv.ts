/**
 * OHLCV Ingestion Workflow
 * =========================
 *
 * Orchestrates OHLCV data ingestion:
 * 1. Generate worklist from DuckDB (offline work planning)
 * 2. Fetch candles from API (online boundary)
 * 3. Store candles in ClickHouse
 * 4. Return structured, serializable results
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { ValidationError } from '@quantbot/utils';
import type { WorkflowContext } from '../types.js';
import { generateOhlcvWorklist, type OhlcvWorkItem } from '@quantbot/ingestion';
import { createOhlcvIngestionContext } from '../context/createOhlcvIngestionContext.js';

/**
 * OHLCV Ingestion Spec
 */
export const IngestOhlcvSpecSchema = z.object({
  duckdbPath: z.string().min(1, 'duckdbPath is required'),
  from: z.string().optional(), // ISO date string
  to: z.string().optional(), // ISO date string
  side: z.enum(['buy', 'sell']).optional().default('buy'),
  chain: z.enum(['solana', 'ethereum', 'base', 'bsc']).optional().default('solana'),
  interval: z.enum(['15s', '1m', '5m', '1H']).optional().default('1m'),
  preWindowMinutes: z.number().int().min(0).optional().default(260),
  postWindowMinutes: z.number().int().min(0).optional().default(1440),
  errorMode: z.enum(['collect', 'failFast']).optional().default('collect'),
  checkCoverage: z.boolean().optional().default(true),
  rateLimitMs: z.number().int().min(0).optional().default(100),
  maxRetries: z.number().int().min(0).optional().default(3),
});

export type IngestOhlcvSpec = z.infer<typeof IngestOhlcvSpecSchema>;

/**
 * OHLCV Ingestion Result (JSON-serializable)
 */
export type IngestOhlcvResult = {
  worklistGenerated: number;
  workItemsProcessed: number;
  workItemsSucceeded: number;
  workItemsFailed: number;
  workItemsSkipped: number;
  totalCandlesFetched: number;
  totalCandlesStored: number;
  errors: Array<{
    mint: string;
    chain: string;
    error: string;
  }>;
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
};

/**
 * Extended WorkflowContext for OHLCV ingestion
 */
export type IngestOhlcvContext = WorkflowContext & {
  jobs: {
    ohlcvFetch: {
      fetchWorkList: (worklist: OhlcvWorkItem[]) => Promise<
        Array<{
          workItem: OhlcvWorkItem;
          success: boolean;
          candlesFetched: number;
          candlesStored: number;
          error?: string;
          durationMs: number;
        }>
      >;
    };
  };
};

/**
 * OHLCV Ingestion Workflow
 *
 * Follows workflow contract:
 * - Validates spec (Zod schema)
 * - Uses WorkflowContext (DI) - all dependencies via context
 * - Returns JSON-serializable result (ISO strings, no Date objects)
 * - Explicit error policy (collect vs failFast)
 * - Default parameter pattern for ctx (for testing convenience)
 *
 * NOTE: ctx is required in production. Default is provided for testing only.
 */
export async function ingestOhlcv(
  spec: IngestOhlcvSpec,
  ctx: IngestOhlcvContext = createOhlcvIngestionContext()
): Promise<IngestOhlcvResult> {
  const startedAt = DateTime.utc();
  const startedAtISO = startedAt.toISO()!;

  // 1. Validate spec
  const parsed = IngestOhlcvSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid OHLCV ingestion spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;
  const errorMode = validated.errorMode ?? 'collect';

  ctx.logger.info('Starting OHLCV ingestion workflow', {
    duckdbPath: validated.duckdbPath,
    from: validated.from,
    to: validated.to,
    side: validated.side,
    interval: validated.interval,
  });

  // 2. Generate worklist (offline - DuckDB query)
  let worklist: OhlcvWorkItem[];
  try {
    worklist = await generateOhlcvWorklist(validated.duckdbPath, {
      from: validated.from ? new Date(validated.from) : undefined,
      to: validated.to ? new Date(validated.to) : undefined,
      side: validated.side,
      chain: validated.chain,
      interval: validated.interval,
      preWindowMinutes: validated.preWindowMinutes,
      postWindowMinutes: validated.postWindowMinutes,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Failed to generate worklist', { error: errorMessage });
    if (errorMode === 'failFast') {
      throw error;
    }
    return {
      worklistGenerated: 0,
      workItemsProcessed: 0,
      workItemsSucceeded: 0,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [{ mint: 'N/A', chain: validated.chain, error: errorMessage }],
      startedAtISO,
      completedAtISO: DateTime.utc().toISO()!,
      durationMs: DateTime.utc().diff(startedAt, 'milliseconds').milliseconds,
    };
  }

  if (worklist.length === 0) {
    ctx.logger.info('No work items to process');
    return {
      worklistGenerated: 0,
      workItemsProcessed: 0,
      workItemsSucceeded: 0,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [],
      startedAtISO,
      completedAtISO: DateTime.utc().toISO()!,
      durationMs: DateTime.utc().diff(startedAt, 'milliseconds').milliseconds,
    };
  }

  // 3. Execute fetch job (online boundary)
  let fetchResults: Array<{
    workItem: OhlcvWorkItem;
    success: boolean;
    candlesFetched: number;
    candlesStored: number;
    error?: string;
    durationMs: number;
  }>;

  try {
    fetchResults = await ctx.jobs.ohlcvFetch.fetchWorkList(worklist);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Failed to fetch OHLCV data', { error: errorMessage });
    if (errorMode === 'failFast') {
      throw error;
    }
    // Return partial results
    fetchResults = worklist.map((item) => ({
      workItem: item,
      success: false,
      candlesFetched: 0,
      candlesStored: 0,
      error: errorMessage,
      durationMs: 0,
    }));
  }

  // 4. Aggregate results (JSON-serializable)
  const workItemsSucceeded = fetchResults.filter((r) => r.success).length;
  const workItemsFailed = fetchResults.filter((r) => !r.success).length;
  const workItemsSkipped = fetchResults.filter((r) => r.success && r.candlesFetched === 0).length;
  const totalCandlesFetched = fetchResults.reduce((sum, r) => sum + r.candlesFetched, 0);
  const totalCandlesStored = fetchResults.reduce((sum, r) => sum + r.candlesStored, 0);

  const errors = fetchResults
    .filter((r) => !r.success && r.error)
    .map((r) => ({
      mint: r.workItem.mint,
      chain: r.workItem.chain,
      error: r.error!,
    }));

  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt, 'milliseconds').milliseconds;

  ctx.logger.info('Completed OHLCV ingestion workflow', {
    worklistGenerated: worklist.length,
    workItemsProcessed: fetchResults.length,
    workItemsSucceeded,
    workItemsFailed,
    totalCandlesStored,
  });

  return {
    worklistGenerated: worklist.length,
    workItemsProcessed: fetchResults.length,
    workItemsSucceeded,
    workItemsFailed,
    workItemsSkipped,
    totalCandlesFetched,
    totalCandlesStored,
    errors,
    startedAtISO,
    completedAtISO,
    durationMs,
  };
}
