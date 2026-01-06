/**
 * InfluxDB Client (Stub Implementation)
 * ======================================
 *
 * InfluxDB is not currently in use. This file provides type definitions
 * and stub implementations for backward compatibility.
 *
 * All methods return empty/default values.
 */

import { logger } from '../utils/index.js';

export interface OHLCVData {
  timestamp: number;
  dateTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  chain: string;
  recordCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export class InfluxDBOHLCVClient {
  // InfluxDB is not in use - all methods are stubbed
  constructor() {
    // No-op - InfluxDB not in use
  }

  /**
   * Initialize InfluxDB bucket and retention policy
   */
  async initialize(): Promise<void> {
    logger.warn('InfluxDB is not in use - initialize() is a no-op');
  }

  /**
   * Write OHLCV data points to InfluxDB
   */
  async writeOHLCVData(
    _tokenAddress: string,
    _tokenSymbol: string,
    _chain: string,
    _data: OHLCVData[]
  ): Promise<void> {
    logger.warn('InfluxDB is not in use - writeOHLCVData() is a no-op');
  }

  /**
   * Query OHLCV data from InfluxDB
   */
  async getOHLCVData(
    _tokenAddress: string,
    _startTime: Date,
    _endTime: Date,
    _interval: string = '1m'
  ): Promise<OHLCVData[]> {
    logger.warn('InfluxDB is not in use - getOHLCVData() returns empty array');
    return [];
  }

  /**
   * Get latest price for a token
   */
  async getLatestPrice(_tokenAddress: string): Promise<number> {
    logger.warn('InfluxDB is not in use - getLatestPrice() returns 0');
    return 0;
  }

  /**
   * Check if data exists for token in time range
   */
  async hasData(_tokenAddress: string, _startTime: Date, _endTime: Date): Promise<boolean> {
    logger.warn('InfluxDB is not in use - hasData() returns false');
    return false;
  }

  /**
   * Get all tokens with available data
   */
  async getAvailableTokens(): Promise<TokenInfo[]> {
    logger.warn('InfluxDB is not in use - getAvailableTokens() returns empty array');
    return [];
  }

  /**
   * Get record count for a specific token
   */
  async getTokenRecordCount(_tokenAddress: string): Promise<number> {
    logger.warn('InfluxDB is not in use - getTokenRecordCount() returns 0');
    return 0;
  }

  /**
   * Close the InfluxDB connection
   */
  async close(): Promise<void> {
    logger.warn('InfluxDB is not in use - close() is a no-op');
  }
}

// Export singleton instance
export const influxDBClient = new InfluxDBOHLCVClient();
