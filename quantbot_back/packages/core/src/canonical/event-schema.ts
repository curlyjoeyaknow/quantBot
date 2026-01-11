/**
 * Canonical Event Schema
 *
 * Unified schema for all market events:
 * (asset, venue, timestamp, event_type, value, confidence)
 *
 * This allows chain-agnostic, venue-agnostic queries across all data types.
 */

import { z } from 'zod';

/**
 * Asset identifier (chain-agnostic, normalized)
 */
export const AssetSchema = z.object({
  /**
   * Normalized address (lowercase for EVM, case-preserved for Solana)
   */
  address: z.string(),

  /**
   * Chain identifier (normalized to lowercase)
   */
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']),

  /**
   * Optional symbol/ticker
   */
  symbol: z.string().optional(),

  /**
   * Optional name
   */
  name: z.string().optional(),
});

export type Asset = z.infer<typeof AssetSchema>;

/**
 * Venue identifier
 */
export const VenueSchema = z.object({
  /**
   * Venue name (e.g., 'birdeye', 'dex', 'telegram')
   */
  name: z.string(),

  /**
   * Venue type
   */
  type: z.enum(['dex', 'cex', 'data_provider', 'social', 'on_chain']),

  /**
   * Optional venue-specific identifier
   */
  venueId: z.string().optional(),
});

export type Venue = z.infer<typeof VenueSchema>;

/**
 * Event type
 */
export type EventType =
  | 'price'
  | 'trade'
  | 'alert'
  | 'candle'
  | 'volume'
  | 'liquidity'
  | 'metadata';

/**
 * Canonical event schema
 *
 * Unified representation for all market events:
 * - Price updates
 * - Trades
 * - Alerts/calls
 * - OHLCV candles
 * - Volume data
 * - Liquidity data
 */
export const CanonicalEventSchema = z.object({
  /**
   * Unique event ID
   */
  id: z.string(),

  /**
   * Asset identifier
   */
  asset: AssetSchema,

  /**
   * Venue identifier
   */
  venue: VenueSchema,

  /**
   * Event timestamp (ISO 8601)
   */
  timestamp: z.string(),

  /**
   * Event type
   */
  eventType: z.enum(['price', 'trade', 'alert', 'candle', 'volume', 'liquidity', 'metadata']),

  /**
   * Event value (type-specific)
   * - price: number (USD)
   * - trade: { side: 'buy'|'sell', amount: number, price: number }
   * - alert: { caller: string, text: string }
   * - candle: { open, high, low, close, volume }
   * - volume: number (USD)
   * - liquidity: number (USD)
   * - metadata: Record<string, unknown>
   */
  value: z.unknown(),

  /**
   * Confidence level (0-1) for data quality
   */
  confidence: z.number().min(0).max(1).optional(),

  /**
   * Optional metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /**
   * Source raw data hash (for traceability)
   */
  sourceHash: z.string().optional(),

  /**
   * Source run ID (for traceability)
   */
  sourceRunId: z.string().optional(),
});

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;
