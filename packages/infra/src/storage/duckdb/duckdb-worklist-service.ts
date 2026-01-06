/**
 * DuckDB Worklist Service
 *
 * Provides a service interface for querying DuckDB worklist data.
 * Wraps PythonEngine calls to maintain separation of concerns.
 *
 * This service is part of the storage layer and is the only place
 * where PythonEngine should be used for worklist operations.
 */

import { PythonEngine, getPythonEngine } from '../../utils/index.js';
import { logger } from '../../utils/index.js';

export interface OhlcvWorklistConfig {
  duckdbPath: string;
  from?: string;
  to?: string;
  side?: 'buy' | 'sell';
  mints?: string[];
}

export interface OhlcvWorklistResult {
  tokenGroups: Array<{
    mint: string;
    chain: string;
    /** Raw Unix timestamp in milliseconds from DuckDB */
    earliestAlertTsMs: number | null;
    callCount: number;
  }>;
  calls: Array<{
    mint: string;
    chain: string;
    /** Raw Unix timestamp in milliseconds from DuckDB - use directly for API calls */
    alertTsMs: number | null;
    chatId: string | null;
    messageId: string | null;
    priceUsd: number | null;
    mcapUsd: number | null;
    botTsMs: number | null;
  }>;
}

/**
 * DuckDB Worklist Service
 *
 * Provides a service interface for querying DuckDB worklist data.
 * This service wraps PythonEngine calls to maintain architectural boundaries.
 */
export class DuckDBWorklistService {
  constructor(private readonly pythonEngine: PythonEngine = getPythonEngine()) {}

  /**
   * Query DuckDB for OHLCV worklist data
   *
   * @param config - Worklist query configuration
   * @returns Worklist result with token groups and calls
   */
  async queryWorklist(config: OhlcvWorklistConfig): Promise<OhlcvWorklistResult> {
    try {
      const result = await this.pythonEngine.runOhlcvWorklist(config);
      return result;
    } catch (error) {
      logger.error('Failed to query DuckDB worklist', error as Error, { config });
      throw error;
    }
  }
}

/**
 * Get or create DuckDB worklist service instance
 */
let worklistServiceInstance: DuckDBWorklistService | null = null;

export function getDuckDBWorklistService(): DuckDBWorklistService {
  if (!worklistServiceInstance) {
    worklistServiceInstance = new DuckDBWorklistService();
  }
  return worklistServiceInstance;
}
