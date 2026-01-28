/**
 * Calls Port
 *
 * Interface for querying and retrieving calls (trading signals).
 */

import { DateTime } from 'luxon';
import type { Call, Alert } from '../domain/calls/index.js';
import type { CallSelection } from '../domain/strategies/index.js';
import type { TokenAddress } from '../domain/tokens/index.js';

/**
 * Query filter for calls
 */
export interface CallsQueryFilter {
  /**
   * Filter by caller IDs
   */
  callerIds?: number[];

  /**
   * Filter by caller names
   */
  callerNames?: string[];

  /**
   * Filter by token addresses
   */
  tokenAddresses?: TokenAddress[];

  /**
   * Filter by time range
   */
  timeRange?: {
    from: DateTime;
    to: DateTime;
  };

  /**
   * Filter by side
   */
  side?: 'buy' | 'sell';

  /**
   * Filter by signal types
   */
  signalTypes?: string[];

  /**
   * Limit number of results
   */
  limit?: number;

  /**
   * Offset for pagination
   */
  offset?: number;
}

/**
 * Calls query result
 */
export interface CallsQueryResult {
  /**
   * Matching calls
   */
  calls: Call[];

  /**
   * Total count (before limit/offset)
   */
  total: number;
}

/**
 * Calls port interface
 */
export interface CallsPort {
  /**
   * Query calls by filter
   *
   * @param filter - Query filter
   * @returns Query result with calls and total count
   */
  queryCalls(filter: CallsQueryFilter): Promise<CallsQueryResult>;

  /**
   * Get call by ID
   *
   * @param id - Call ID
   * @returns Call if found, null otherwise
   */
  getCall(id: number): Promise<Call | null>;

  /**
   * Get alert by ID
   *
   * @param id - Alert ID
   * @returns Alert if found, null otherwise
   */
  getAlert(id: number): Promise<Alert | null>;

  /**
   * Check if port is available
   */
  isAvailable(): Promise<boolean>;
}
