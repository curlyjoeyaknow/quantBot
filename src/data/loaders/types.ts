/**
 * Data Loader Types and Interfaces
 * 
 * Defines interfaces for loading data from various sources (CSV, ClickHouse, etc.)
 */

import { DateTime } from 'luxon';

/**
 * Parameters for loading data
 */
export interface LoadParams {
  source: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

/**
 * Result of a data load operation
 */
export interface LoadResult {
  mint: string;
  chain: string;
  timestamp: DateTime;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  caller?: string;
  [key: string]: unknown;
}

/**
 * Base interface for all data loaders
 */
export interface DataLoader {
  /**
   * Load data based on parameters
   */
  load(params: LoadParams): Promise<LoadResult[]>;
  
  /**
   * Check if this loader can handle the given source
   */
  canLoad(source: string): boolean;
  
  /**
   * Get loader name for identification
   */
  readonly name: string;
}

/**
 * CSV-specific load parameters
 */
export interface CsvLoadParams extends LoadParams {
  path: string;
  mintField: string;
  chainField: string;
  timestampField: string;
  startOffsetMinutes?: number;
  durationHours?: number;
  filter?: Record<string, unknown>;
}

/**
 * ClickHouse-specific load parameters
 */
export interface ClickHouseLoadParams extends LoadParams {
  query?: string;
  mint?: string;
  chain?: string;
  startTime?: DateTime;
  endTime?: DateTime;
}

/**
 * Caller-specific load parameters
 */
export interface CallerLoadParams extends LoadParams {
  caller: string;
  chain?: string;
  limit?: number;
  includeFailed?: boolean;
  lookbackDays?: number;
}

