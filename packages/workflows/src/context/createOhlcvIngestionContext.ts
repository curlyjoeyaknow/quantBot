/**
 * Create WorkflowContext for OHLCV ingestion
 *
 * Extends the base WorkflowContext with jobs service for OHLCV fetching.
 */

import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';
import { logger as utilsLogger } from '@quantbot/utils';
import { createProductionContext, type ProductionContextConfig } from './createProductionContext.js';
import { OhlcvFetchJob } from '@quantbot/jobs';
import type { IngestOhlcvContext } from '../ohlcv/ingestOhlcv.js';
import type { WorkflowContext } from '../types.js';

export interface OhlcvIngestionContextConfig extends ProductionContextConfig {
  /**
   * Optional OHLCV fetch job (for testing)
   */
  ohlcvFetchJob?: OhlcvFetchJob;
}

/**
 * Create WorkflowContext for OHLCV ingestion with jobs service
 */
export function createOhlcvIngestionContext(
  config?: OhlcvIngestionContextConfig
): IngestOhlcvContext {
  const baseContext: WorkflowContext = createProductionContext(config);

  const fetchJob = config?.ohlcvFetchJob ?? new OhlcvFetchJob();

  return {
    ...baseContext,
    jobs: {
      ohlcvFetch: {
        async fetchWorkList(worklist) {
          return fetchJob.fetchWorkList(worklist);
        },
      },
    },
  };
}

