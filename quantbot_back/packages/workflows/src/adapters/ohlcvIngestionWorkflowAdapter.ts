/**
 * OHLCV Ingestion Workflow Adapter
 *
 * Implements OhlcvIngestionPort by calling the existing ingestOhlcv workflow.
 * This adapter bridges the port interface to the workflow implementation.
 */

import type { OhlcvIngestionPort, IngestOhlcvSpec, IngestOhlcvResult } from '@quantbot/core';
import type { WorkflowContext } from '../types.js';
import { ingestOhlcv, type IngestOhlcvResult as WorkflowResult } from '../ohlcv/ingestOhlcv.js';
import { createOhlcvIngestionContext } from '../context/createOhlcvIngestionContext.js';
// OhlcvFetchJob removed - workflow now uses ports directly

/**
 * Creates an OHLCV Ingestion adapter that implements the port interface
 * by calling the existing workflow.
 *
 * @param ctx - Workflow context (optional, will create default if not provided)
 * @param options - Configuration options for the adapter
 * @returns OhlcvIngestionPort implementation
 */
export function createOhlcvIngestionWorkflowAdapter(
  ctx?: WorkflowContext,
  _options?: {
    parallelWorkers?: number;
    rateLimitMsPerWorker?: number;
    maxRetries?: number;
    checkCoverage?: boolean;
  }
): OhlcvIngestionPort {
  return {
    async ingest(spec: IngestOhlcvSpec): Promise<IngestOhlcvResult> {
      // Create workflow context (async - uses ports, no OhlcvFetchJob needed)
      const workflowCtx = ctx
        ? await createOhlcvIngestionContext()
        : await createOhlcvIngestionContext();

      // Map port spec to workflow spec (chain: 'evm' -> 'ethereum')
      const workflowSpec = {
        ...spec,
        chain: spec.chain === 'evm' ? 'ethereum' : spec.chain,
      } as Parameters<typeof ingestOhlcv>[0];

      // Call the workflow
      const workflowResult: WorkflowResult = await ingestOhlcv(workflowSpec, workflowCtx);

      // Transform workflow result to port result shape
      return {
        ok: workflowResult.workItemsFailed === 0,
        summary: {
          worklistGenerated: workflowResult.worklistGenerated,
          workItemsProcessed: workflowResult.workItemsProcessed,
          workItemsSucceeded: workflowResult.workItemsSucceeded,
          workItemsFailed: workflowResult.workItemsFailed,
          workItemsSkipped: workflowResult.workItemsSkipped,
          totalCandlesFetched: workflowResult.totalCandlesFetched,
          totalCandlesStored: workflowResult.totalCandlesStored,
          durationMs: workflowResult.durationMs,
        },
        details: {
          startedAtISO: workflowResult.startedAtISO,
          completedAtISO: workflowResult.completedAtISO,
        },
        errors:
          workflowResult.errors.length > 0
            ? workflowResult.errors.map((e) => ({
                message: e.error,
                context: { mint: e.mint, chain: e.chain },
              }))
            : undefined,
      };
    },
  };
}
