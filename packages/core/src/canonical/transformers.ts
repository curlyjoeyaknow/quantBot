/**
 * Canonical Transformers
 *
 * Transform domain-specific data types to canonical event format.
 */

import { DateTime } from 'luxon';
import type { CanonicalEvent, Asset, Venue } from './event-schema.js';
import type { CallSignal } from '../domain/calls/CallSignal.js';
import type { Candle } from '../index.js';

/**
 * Map CallSignal chain to Asset chain format
 */
function mapChainToAssetChain(chain: CallSignal['token']['chain']): Asset['chain'] {
  const chainMap: Record<CallSignal['token']['chain'], Asset['chain']> = {
    sol: 'solana',
    eth: 'ethereum',
    bsc: 'bsc',
    base: 'base',
    arb: 'arbitrum',
    op: 'arbitrum', // Arbitrum for now, or add 'optimism' to Asset if needed
    unknown: 'solana', // Default fallback
  };
  return chainMap[chain] || 'solana';
}

/**
 * Transform CallSignal to canonical alert event
 */
export function transformCallToCanonical(call: CallSignal): CanonicalEvent {
  const snapshot = call.enrichment?.snapshot;

  return {
    id: `call-${call.token.address}-${call.tsMs}`,
    asset: {
      address: call.token.address,
      chain: mapChainToAssetChain(call.token.chain),
      symbol: snapshot?.symbol,
      name: snapshot?.name,
    },
    venue: {
      name: call.caller.displayName,
      type: 'social',
      venueId: call.caller.fromId,
    },
    timestamp: DateTime.fromMillis(call.tsMs).toISO()!,
    eventType: 'alert',
    value: {
      caller: call.caller.displayName,
      text: snapshot?.rawText,
      price: snapshot?.priceUsd,
      marketCap: snapshot?.marketCapUsd,
    },
    confidence: call.parse.confidence,
    metadata: {
      callerId: call.caller.fromId,
      messageId: call.source.callerMessageId.toString(),
      chatId: call.source.chatId,
      enrichmentMessageId: call.source.enrichmentMessageId?.toString(),
    },
  };
}

/**
 * Transform Candle to canonical candle event
 */
export function transformCandleToCanonical(
  candle: Candle,
  asset: Asset,
  venue: Venue,
  sourceHash?: string,
  sourceRunId?: string
): CanonicalEvent {
  return {
    id: `candle-${asset.address}-${candle.timestamp}`,
    asset,
    venue,
    timestamp: DateTime.fromSeconds(candle.timestamp).toISO()!,
    eventType: 'candle',
    value: {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    },
    confidence: 1.0, // OHLCV data is typically high confidence
    metadata: {
      interval: '5m', // TODO: Make configurable
    },
    sourceHash,
    sourceRunId,
  };
}

/**
 * Transform price data to canonical price event
 */
export function transformPriceToCanonical(
  price: number,
  asset: Asset,
  venue: Venue,
  timestamp: string,
  sourceHash?: string
): CanonicalEvent {
  return {
    id: `price-${asset.address}-${timestamp}`,
    asset,
    venue,
    timestamp,
    eventType: 'price',
    value: price,
    confidence: 1.0,
    sourceHash,
  };
}
