/**
 * Event Collector
 *
 * Collects events from various storage sources and converts them to canonical events.
 */

import { DateTime } from 'luxon';
import type { StorageEngine } from '@quantbot/storage';
import type { CanonicalEvent, CallEvent, CandleEvent } from '../canonical/schemas.js';
import type { SnapshotSpec } from './types.js';
import { createCanonicalEvent } from '../canonical/schemas.js';

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
 * Storage-based event collector
 *
 * Collects events from StorageEngine and converts to canonical format
 */
export class StorageEventCollector implements EventCollector {
  constructor(private readonly storage: StorageEngine) {}

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
   * TODO: Implement actual call collection from DuckDB
   * This is a placeholder that needs to be connected to actual call storage
   */
  private async collectCalls(
    spec: SnapshotSpec,
    from: DateTime,
    to: DateTime
  ): Promise<CallEvent[]> {
    // Placeholder - will query DuckDB user_calls_d table
    // For now, return empty array
    return [];
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

    // Get token addresses from filters or query all
    const tokenAddresses = spec.filters?.tokenAddresses || [];

    if (tokenAddresses.length === 0) {
      // TODO: Query all tokens with data in time range
      // For now, return empty if no tokens specified
      return [];
    }

    // Collect candles for each token
    for (const tokenAddress of tokenAddresses) {
      const chain = spec.filters?.chain || 'solana';

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
        console.error(`Failed to collect OHLCV for ${tokenAddress}:`, error);
      }
    }

    return events;
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
      if (
        filters.venues &&
        filters.venues.length > 0 &&
        !filters.venues.includes(event.venue)
      ) {
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

