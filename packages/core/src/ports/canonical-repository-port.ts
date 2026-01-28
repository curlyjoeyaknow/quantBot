/**
 * Canonical Repository Port
 *
 * Interface for storing and querying canonical events.
 * Canonical events are unified representations of all market data:
 * (asset, venue, timestamp, event_type, value, confidence)
 */

import type { CanonicalEvent } from '../canonical/event-schema.js';

/**
 * Canonical event query filter
 */
export interface CanonicalEventQueryFilter {
  /**
   * Filter by asset address (chain-agnostic, normalized)
   */
  assetAddress?: string;

  /**
   * Filter by chain
   */
  chain?: 'solana' | 'ethereum' | 'bsc' | 'base' | 'evm';

  /**
   * Filter by venue name
   */
  venueName?: string;

  /**
   * Filter by venue type
   */
  venueType?: 'dex' | 'cex' | 'data_provider' | 'social' | 'on_chain';

  /**
   * Filter by event type
   */
  eventType?: 'price' | 'trade' | 'alert' | 'candle' | 'volume' | 'liquidity' | 'metadata';

  /**
   * Filter by time range
   */
  timeRange?: {
    from: string; // ISO 8601
    to: string; // ISO 8601
  };

  /**
   * Filter by source hash (for traceability)
   */
  sourceHash?: string;

  /**
   * Filter by source run ID (for traceability)
   */
  sourceRunId?: string;

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
 * Canonical event query result
 */
export interface CanonicalEventQueryResult {
  /**
   * Matching events
   */
  events: CanonicalEvent[];

  /**
   * Total count (before limit/offset)
   */
  total: number;
}

/**
 * Canonical repository port
 */
export interface CanonicalRepository {
  /**
   * Store a canonical event
   *
   * If event with same ID exists, may update or return existing.
   */
  store(event: CanonicalEvent): Promise<void>;

  /**
   * Store multiple canonical events (batch)
   */
  storeBatch(events: CanonicalEvent[]): Promise<void>;

  /**
   * Get canonical event by ID
   *
   * @returns Event if found, null otherwise
   */
  get(id: string): Promise<CanonicalEvent | null>;

  /**
   * Query canonical events by filter
   *
   * Supports chain-agnostic queries (normalizes addresses).
   *
   * @returns Query result with events and total count
   */
  query(filter: CanonicalEventQueryFilter): Promise<CanonicalEventQueryResult>;

  /**
   * Get events for a specific asset
   *
   * Chain-agnostic: normalizes addresses before querying.
   *
   * @param assetAddress - Asset address (normalized)
   * @param timeRange - Optional time range filter
   * @param eventTypes - Optional event types to filter
   * @returns Array of events
   */
  getByAsset(
    assetAddress: string,
    timeRange?: { from: string; to: string },
    eventTypes?: CanonicalEvent['eventType'][]
  ): Promise<CanonicalEvent[]>;

  /**
   * Check if repository is available
   *
   * @returns true if repository can be used
   */
  isAvailable(): Promise<boolean>;
}
