/**
 * Event Collector
 *
 * Collects events from various storage sources and converts them to canonical events.
 */

import { DateTime } from 'luxon';
import type { StorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { z } from 'zod';
import type { CanonicalEvent, CallEvent, CandleEvent } from '../canonical/schemas.js';
import type { SnapshotSpec } from './types.js';

/**
 * Schema for DuckDB calls query result
 */
const CallsQueryResultSchema = z.object({
  success: z.boolean(),
  calls: z
    .array(
      z.object({
        mint: z.string(),
        alert_timestamp: z.string(), // ISO format timestamp
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

/**
 * Event collector interface
 */
export interface EventCollector {
  /**
   * Collect events based on snapshot spec
   */
  collectEvents(spec: SnapshotSpec): Promise<CanonicalEvent[]>;
}

/**
 * Options for StorageEventCollector
 */
export interface StorageEventCollectorOptions {
  /**
   * Path to DuckDB database for querying calls
   * If not provided, call collection will return empty array
   */
  duckdbPath?: string;
}

/**
 * Storage-based event collector
 *
 * Collects events from StorageEngine and converts to canonical format
 */
export class StorageEventCollector implements EventCollector {
  constructor(
    private readonly storage: StorageEngine,
    private readonly options: StorageEventCollectorOptions = {}
  ) {}

  async collectEvents(spec: SnapshotSpec): Promise<CanonicalEvent[]> {
    const events: CanonicalEvent[] = [];
    const from = DateTime.fromISO(spec.from);
    const to = DateTime.fromISO(spec.to);

    // Collect based on sources
    for (const source of spec.sources) {
      switch (source) {
        case 'calls':
          events.push(...(await this.collectCalls(spec, from, to)));
          break;
        case 'ohlcv':
          events.push(...(await this.collectOhlcv(spec, from, to)));
          break;
        case 'trades':
          // TODO: Implement trade collection when trade storage is available
          break;
        case 'metadata':
          // TODO: Implement metadata collection
          break;
        case 'signals':
          // TODO: Implement signal collection
          break;
        case 'all':
          events.push(...(await this.collectCalls(spec, from, to)));
          events.push(...(await this.collectOhlcv(spec, from, to)));
          break;
      }
    }

    // Apply filters
    return this.applyFilters(events, spec.filters);
  }

  /**
   * Collect call events from storage
   *
   * Queries calls from DuckDB user_calls_d table and converts to canonical format
   */
  private async collectCalls(
    spec: SnapshotSpec,
    from: DateTime,
    to: DateTime
  ): Promise<CallEvent[]> {
    const events: CallEvent[] = [];

    // If no DuckDB path is provided, return empty array
    if (!this.options.duckdbPath) {
      logger.warn('DuckDB path not provided, skipping call collection');
      return [];
    }

    try {
      // Use PythonEngine directly to query calls from DuckDB
      // This avoids dependency on @quantbot/simulation package
      const { PythonEngine, getPythonEngine } = await import('@quantbot/utils');
      const pythonEngine = getPythonEngine();

      // Query calls using PythonEngine.runDuckDBStorage
      const rawResult = await pythonEngine.runDuckDBStorage({
        duckdbPath: this.options.duckdbPath,
        operation: 'query_calls',
        data: {
          limit: 10000, // Large limit to get all calls in time range
          exclude_unrecoverable: true,
        },
      });

      // Validate result schema
      const result = CallsQueryResultSchema.parse(rawResult);

      if (!result.success || !result.calls) {
        logger.warn('Failed to query calls from DuckDB', { error: result.error });
        return [];
      }

      // Filter calls by time range and convert to canonical format
      const chain = spec.filters?.chain || 'solana';
      const tokenAddresses = spec.filters?.tokenAddresses;

      for (const call of result.calls) {
        const callDate = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' });

        // Skip if outside time range
        if (callDate < from || callDate > to) {
          continue;
        }

        // Skip if token filter is specified and this token is not in the list
        if (tokenAddresses && tokenAddresses.length > 0 && !tokenAddresses.includes(call.mint)) {
          continue;
        }

        // Convert to canonical CallEvent
        const event: CallEvent = {
          asset: call.mint,
          chain: chain as 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm',
          venue: 'telegram', // Calls come from Telegram
          timestamp: callDate.toISO()!,
          eventType: 'call',
          value: {
            side: 'buy', // Default to buy for calls
            signalType: 'entry', // Default to entry for calls
            callerName: spec.filters?.callerNames?.[0], // Use first caller name if available
          },
          isMissing: false,
          source: 'duckdb',
        };

        events.push(event);
      }
    } catch (error) {
      logger.error('Failed to collect calls from DuckDB', error as Error, {
        duckdbPath: this.options.duckdbPath,
      });
      // Return empty array on error rather than throwing
    }

    return events;
  }

  /**
   * Collect OHLCV candle events from storage
   */
  private async collectOhlcv(
    spec: SnapshotSpec,
    from: DateTime,
    to: DateTime
  ): Promise<CandleEvent[]> {
    const events: CandleEvent[] = [];
    const chain = spec.filters?.chain || 'solana';

    // Get token addresses from filters or query all tokens with data in time range
    let tokenAddresses = spec.filters?.tokenAddresses || [];

    if (tokenAddresses.length === 0) {
      // Query all tokens with OHLCV data in the time range
      try {
        tokenAddresses = await this.getAllTokensWithOhlcvInRange(chain, from, to);
        if (tokenAddresses.length === 0) {
          logger.info('No tokens with OHLCV data found in time range', {
            chain,
            from: from.toISO(),
            to: to.toISO(),
          });
          return [];
        }
      } catch (error) {
        logger.warn('Failed to query all tokens with OHLCV data, returning empty', {
          error: error instanceof Error ? error.message : String(error),
          chain,
          from: from.toISO(),
          to: to.toISO(),
        });
        return [];
      }
    }

    // Collect candles for each token
    for (const tokenAddress of tokenAddresses) {
      try {
        // Query candles from storage
        const candles = await this.storage.getCandles(
          tokenAddress,
          chain,
          from,
          to,
          { interval: '5m' } // Default interval, could be made configurable
        );

        // Convert to canonical events
        for (const candle of candles) {
          const timestamp = DateTime.fromSeconds(candle.timestamp).toISO();
          if (!timestamp) {
            continue; // Skip invalid timestamps
          }

          const event: CandleEvent = {
            asset: tokenAddress,
            chain: chain as 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm',
            venue: 'birdeye', // Default venue, could be determined from source
            timestamp,
            eventType: 'candle',
            value: {
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              interval: '5m',
            },
            isMissing: false,
            source: 'storage',
          };
          events.push(event);
        }
      } catch (error) {
        // Log error but continue with other tokens
        logger.error(`Failed to collect OHLCV for ${tokenAddress}`, error as Error);
      }
    }

    return events;
  }

  /**
   * Get all token addresses that have OHLCV data in the specified time range
   * Queries ClickHouse directly to find distinct token addresses
   */
  private async getAllTokensWithOhlcvInRange(
    chain: string,
    from: DateTime,
    to: DateTime
  ): Promise<string[]> {
    try {
      // Import ClickHouse client dynamically to avoid circular dependencies
      const { getClickHouseClient } = await import('@quantbot/storage');
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      const startUnix = Math.floor(from.toSeconds());
      const endUnix = Math.floor(to.toSeconds());
      const escapedChain = chain.replace(/'/g, "''");

      // Query for distinct token addresses with candles in the time range
      const result = await ch.query({
        query: `
          SELECT DISTINCT token_address
          FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
          WHERE chain = '${escapedChain}'
            AND timestamp >= toDateTime(${startUnix})
            AND timestamp <= toDateTime(${endUnix})
          ORDER BY token_address ASC
        `,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });

      const data = (await result.json()) as Array<{ token_address: string }>;

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((row) => row.token_address);
    } catch (error) {
      logger.error('Failed to query tokens with OHLCV data', error as Error, {
        chain,
        from: from.toISO(),
        to: to.toISO(),
      });
      throw error;
    }
  }

  /**
   * Apply filters to events
   */
  private applyFilters(
    events: CanonicalEvent[],
    filters?: SnapshotSpec['filters']
  ): CanonicalEvent[] {
    if (!filters) {
      return events;
    }

    return events.filter((event) => {
      // Chain filter
      if (filters.chain && event.chain !== filters.chain) {
        return false;
      }

      // Token address filter
      if (
        filters.tokenAddresses &&
        filters.tokenAddresses.length > 0 &&
        !filters.tokenAddresses.includes(event.asset)
      ) {
        return false;
      }

      // Venue filter
      if (filters.venues && filters.venues.length > 0 && !filters.venues.includes(event.venue)) {
        return false;
      }

      // Event type filter
      if (
        filters.eventTypes &&
        filters.eventTypes.length > 0 &&
        !filters.eventTypes.includes(event.eventType)
      ) {
        return false;
      }

      return true;
    });
  }
}
