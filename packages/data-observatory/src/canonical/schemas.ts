/**
 * Canonical Data Model Schemas
 *
 * Unified event schemas for all data types:
 * - Calls (trading signals)
 * - Trades (executions)
 * - OHLCV (market data)
 * - Metadata (token info)
 * - Signals (derived indicators)
 *
 * All events follow the pattern:
 * (asset, venue, timestamp, event_type, value, confidence)
 */

import { z } from 'zod';
import type { Chain, TokenAddress } from '@quantbot/core';
import { DateTime } from 'luxon';

/**
 * Supported venues (exchanges/platforms)
 */
export const VenueSchema = z.enum([
  'pump.fun',
  'pumpswap',
  'raydium',
  'jupiter',
  'birdeye',
  'telegram',
  'unknown',
]);

export type Venue = z.infer<typeof VenueSchema>;

/**
 * Event types in the canonical model
 */
export const EventTypeSchema = z.enum([
  'call', // Trading signal/call
  'trade', // Executed trade
  'candle', // OHLCV candle
  'metadata', // Token metadata
  'signal', // Derived signal/indicator
  'price_update', // Price update
  'volume_update', // Volume update
]);

export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Base canonical event schema
 *
 * Every event in the system can be expressed as:
 * (asset, venue, timestamp, event_type, value, confidence)
 */
export const CanonicalEventSchema = z.object({
  /**
   * Asset identifier (token address/mint)
   * CRITICAL: Full address, case-preserved, never truncated
   */
  asset: z.string().min(32).max(44),

  /**
   * Chain identifier (normalized lowercase)
   */
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'monad', 'evm']),

  /**
   * Venue where the event occurred
   */
  venue: VenueSchema,

  /**
   * Timestamp in ISO 8601 format (UTC)
   */
  timestamp: z.string().datetime(),

  /**
   * Event type
   */
  eventType: EventTypeSchema,

  /**
   * Event value (type-specific)
   * For calls: signal strength
   * For trades: price
   * For candles: OHLCV data
   * For metadata: metadata object
   */
  value: z.unknown(),

  /**
   * Confidence score (0-1, optional)
   */
  confidence: z.number().min(0).max(1).optional(),

  /**
   * Explicit missingness indicator
   * true = data is missing/unknown
   * false = data is present
   */
  isMissing: z.boolean().default(false),

  /**
   * Source of the event (for traceability)
   */
  source: z.string().optional(),

  /**
   * Additional metadata (type-specific)
   */
  metadata: z.record(z.unknown()).optional(),
});

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

/**
 * Call event (trading signal)
 */
export const CallEventSchema = CanonicalEventSchema.extend({
  eventType: z.literal('call'),
  value: z.object({
    side: z.enum(['buy', 'sell']),
    signalType: z.enum(['entry', 'exit', 'scale_in', 'scale_out']),
    signalStrength: z.number().min(0).max(1).optional(),
    price: z.number().optional(),
    mcap: z.number().optional(),
    callerName: z.string().optional(),
    callerId: z.string().optional(),
  }),
});

export type CallEvent = z.infer<typeof CallEventSchema>;

/**
 * Trade event (execution)
 */
export const TradeEventSchema = CanonicalEventSchema.extend({
  eventType: z.literal('trade'),
  value: z.object({
    side: z.enum(['buy', 'sell']),
    price: z.number(),
    size: z.number(),
    fee: z.number().optional(),
    slippage: z.number().optional(),
    txHash: z.string().optional(),
  }),
});

export type TradeEvent = z.infer<typeof TradeEventSchema>;

/**
 * Candle event (OHLCV)
 */
export const CandleEventSchema = CanonicalEventSchema.extend({
  eventType: z.literal('candle'),
  value: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
  }),
});

export type CandleEvent = z.infer<typeof CandleEventSchema>;

/**
 * Metadata event (token info)
 */
export const MetadataEventSchema = CanonicalEventSchema.extend({
  eventType: z.literal('metadata'),
  value: z.object({
    name: z.string().optional(),
    symbol: z.string().optional(),
    decimals: z.number().optional(),
    logoURI: z.string().optional(),
    price: z.number().optional(),
    marketCap: z.number().optional(),
    volume24h: z.number().optional(),
    priceChange24h: z.number().optional(),
  }),
});

export type MetadataEvent = z.infer<typeof MetadataEventSchema>;

/**
 * Signal event (derived indicator)
 */
export const SignalEventSchema = CanonicalEventSchema.extend({
  eventType: z.literal('signal'),
  value: z.object({
    indicatorName: z.string(),
    indicatorValue: z.number(),
    indicatorParams: z.record(z.unknown()).optional(),
  }),
});

export type SignalEvent = z.infer<typeof SignalEventSchema>;

/**
 * Price update event
 */
export const PriceUpdateEventSchema = CanonicalEventSchema.extend({
  eventType: z.literal('price_update'),
  value: z.object({
    price: z.number(),
    marketCap: z.number().optional(),
    volume: z.number().optional(),
  }),
});

export type PriceUpdateEvent = z.infer<typeof PriceUpdateEventSchema>;

/**
 * Union of all event types
 */
export const CanonicalEventUnionSchema = z.discriminatedUnion('eventType', [
  CallEventSchema,
  TradeEventSchema,
  CandleEventSchema,
  MetadataEventSchema,
  SignalEventSchema,
  PriceUpdateEventSchema,
]);

export type CanonicalEventUnion =
  | CallEvent
  | TradeEvent
  | CandleEvent
  | MetadataEvent
  | SignalEvent
  | PriceUpdateEvent;

/**
 * Helper to create a canonical event from various sources
 */
export function createCanonicalEvent(
  event: Partial<CanonicalEvent>
): CanonicalEvent {
  return CanonicalEventSchema.parse({
    isMissing: false,
    ...event,
  });
}

/**
 * Helper to check if an event is missing data
 */
export function isEventMissing(event: CanonicalEvent): boolean {
  return event.isMissing || event.value === null || event.value === undefined;
}

