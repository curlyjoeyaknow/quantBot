/**
 * Event Collector
 *
 * Collects events from various storage sources and converts them to canonical events.
 */

import { DateTime } from 'luxon';
import type { StorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { z } from 'zod';
import type {
  CanonicalEvent,
  CallEvent,
  CandleEvent,
  TradeEvent,
  MetadataEvent,
  SignalEvent,
} from '../canonical/schemas.js';
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
          events.push(...(await this.collectTrades(spec, from, to)));
          break;
        case 'metadata':
          events.push(...(await this.collectMetadata(spec, from, to)));
          break;
        case 'signals':
          events.push(...(await this.collectSignals(spec, from, to)));
          break;
        case 'all':
          events.push(...(await this.collectCalls(spec, from, to)));
          events.push(...(await this.collectOhlcv(spec, from, to)));
          events.push(...(await this.collectTrades(spec, from, to)));
          events.push(...(await this.collectMetadata(spec, from, to)));
          events.push(...(await this.collectSignals(spec, from, to)));
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
      const { getPythonEngine } = await import('@quantbot/utils');
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
   * Collect trade events from simulation results
   *
   * Queries simulation events from ClickHouse and converts to canonical trade events
   */
  private async collectTrades(
    spec: SnapshotSpec,
    from: DateTime,
    to: DateTime
  ): Promise<TradeEvent[]> {
    const events: TradeEvent[] = [];
    const chain = spec.filters?.chain || 'solana';

    try {
      // Import ClickHouse client dynamically to avoid circular dependencies
      const { getClickHouseClient } = await import('@quantbot/storage');
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      const startUnix = Math.floor(from.toSeconds());
      const endUnix = Math.floor(to.toSeconds());
      const escapedChain = chain.replace(/'/g, "''");

      // Query simulation events that represent trades
      // Note: This queries simulation_events table which contains trade-like events
      const result = await ch.query({
        query: `
          SELECT 
            token_address,
            chain,
            toUnixTimestamp(timestamp) as timestamp,
            event_type,
            event_data
          FROM ${CLICKHOUSE_DATABASE}.simulation_events
          WHERE chain = '${escapedChain}'
            AND timestamp >= toDateTime(${startUnix})
            AND timestamp <= toDateTime(${endUnix})
            AND (event_type = 'entry' OR event_type = 'exit' OR event_type = 'reentry')
          ORDER BY timestamp ASC
        `,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });

      const data = (await result.json()) as Array<{
        token_address: string;
        chain: string;
        timestamp: number;
        event_type: string;
        event_data: string;
      }>;

      if (!Array.isArray(data)) {
        return [];
      }

      // Filter by token addresses if specified
      const tokenAddresses = spec.filters?.tokenAddresses;

      for (const row of data) {
        // Skip if token filter is specified and this token is not in the list
        if (
          tokenAddresses &&
          tokenAddresses.length > 0 &&
          !tokenAddresses.includes(row.token_address)
        ) {
          continue;
        }

        try {
          const eventData = JSON.parse(row.event_data || '{}');
          const side = row.event_type === 'entry' || row.event_type === 'reentry' ? 'buy' : 'sell';
          const price = eventData.price || eventData.executedPrice || 0;
          const size = eventData.quantity || eventData.size || 0;
          const fee = eventData.fees || eventData.fee || 0;
          const slippage = eventData.slippage;

          const event: TradeEvent = {
            asset: row.token_address,
            chain: chain as 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm',
            venue: 'simulation', // Trades from simulation
            timestamp: DateTime.fromSeconds(row.timestamp).toISO()!,
            eventType: 'trade',
            value: {
              side,
              price,
              size,
              fee: fee > 0 ? fee : undefined,
              slippage: slippage !== undefined ? slippage : undefined,
            },
            isMissing: false,
            source: 'clickhouse',
          };

          events.push(event);
        } catch (error) {
          logger.warn(`Failed to parse trade event data for ${row.token_address}`, {
            error: error instanceof Error ? error.message : String(error),
            eventData: row.event_data,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to collect trades from ClickHouse', error as Error, {
        chain,
        from: from.toISO(),
        to: to.toISO(),
      });
      // Return empty array on error rather than throwing
    }

    return events;
  }

  /**
   * Collect metadata events from token metadata storage
   *
   * Queries token metadata from ClickHouse and converts to canonical metadata events
   */
  private async collectMetadata(
    spec: SnapshotSpec,
    from: DateTime,
    to: DateTime
  ): Promise<MetadataEvent[]> {
    const events: MetadataEvent[] = [];
    const chain = spec.filters?.chain || 'solana';

    try {
      // Import ClickHouse client dynamically to avoid circular dependencies
      const { getClickHouseClient } = await import('@quantbot/storage');
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      const startUnix = Math.floor(from.toSeconds());
      const endUnix = Math.floor(to.toSeconds());
      const escapedChain = chain.replace(/'/g, "''");

      // Get token addresses from filters or query all tokens with metadata in time range
      let tokenAddresses = spec.filters?.tokenAddresses || [];

      if (tokenAddresses.length === 0) {
        // Query all tokens with metadata in the time range
        const tokensResult = await ch.query({
          query: `
            SELECT DISTINCT token_address
            FROM ${CLICKHOUSE_DATABASE}.token_metadata
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

        const tokensData = (await tokensResult.json()) as Array<{ token_address: string }>;
        if (Array.isArray(tokensData)) {
          tokenAddresses = tokensData.map((row) => row.token_address);
        }
      }

      if (tokenAddresses.length === 0) {
        logger.info('No tokens with metadata found in time range', {
          chain,
          from: from.toISO(),
          to: to.toISO(),
        });
        return [];
      }

      // Query metadata for each token (get latest snapshot in time range)
      for (const tokenAddress of tokenAddresses) {
        try {
          const metadata = await this.storage.getLatestTokenMetadata(tokenAddress, chain, false);
          if (!metadata) {
            continue;
          }

          // Get metadata history to find snapshots in time range
          const startTime = DateTime.fromSeconds(startUnix);
          const endTime = DateTime.fromSeconds(endUnix);
          const history = await this.storage.getTokenMetadataHistory(
            tokenAddress,
            chain,
            startTime,
            endTime
          );

          // Create metadata events for each snapshot
          for (const snapshot of history) {
            const timestamp = DateTime.fromSeconds(snapshot.timestamp).toISO();
            if (!timestamp) {
              continue;
            }

            const event: MetadataEvent = {
              asset: tokenAddress,
              chain: chain as 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm',
              venue: 'birdeye', // Default venue for metadata
              timestamp,
              eventType: 'metadata',
              value: {
                name: snapshot.name,
                symbol: snapshot.symbol,
                decimals: snapshot.decimals,
                logoURI: snapshot.logoURI,
                price: snapshot.price,
                marketCap: snapshot.marketCap,
                volume24h: snapshot.volume24h,
                priceChange24h: snapshot.priceChange24h,
              },
              isMissing: false,
              source: 'clickhouse',
            };

            events.push(event);
          }
        } catch (error) {
          logger.warn(`Failed to collect metadata for ${tokenAddress}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to collect metadata from ClickHouse', error as Error, {
        chain,
        from: from.toISO(),
        to: to.toISO(),
      });
      // Return empty array on error rather than throwing
    }

    return events;
  }

  /**
   * Collect signal events (derived indicators)
   *
   * Currently returns empty array as signal storage is not yet implemented.
   * Signals would typically be derived from indicators or computed on-the-fly.
   */
  private async collectSignals(
    _spec: SnapshotSpec,
    _from: DateTime,
    _to: DateTime
  ): Promise<SignalEvent[]> {
    // Signal collection is not yet implemented
    // Signals would typically be:
    // - Derived from technical indicators (RSI, MACD, Ichimoku, etc.)
    // - Computed on-the-fly from OHLCV data
    // - Stored in a separate indicators/signals table
    //
    // For now, return empty array rather than throwing an error
    // This allows experiments to proceed without signals if needed
    logger.info('Signal collection not yet implemented, returning empty array');
    return [];
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
