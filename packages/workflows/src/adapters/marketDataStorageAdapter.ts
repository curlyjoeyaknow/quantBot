/**
 * MarketDataPort adapter using Storage Engine (DuckDB/ClickHouse)
 * 
 * This adapter fetches candles from DuckDB/ClickHouse instead of API.
 * Used for lab command and other offline workflows.
 */

import { DateTime } from 'luxon';
import type {
  Candle,
  MarketDataPort,
  MarketDataOhlcvRequest,
  MarketDataMetadataRequest,
  HistoricalPriceRequest,
  HistoricalPriceResponse,
  Chain,
} from '@quantbot/core';
import { getStorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

/**
 * Map MarketDataPort interval to storage engine interval
 */
function mapInterval(interval: string): '1s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d' {
  const intervalMap: Record<string, '1s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d'> = {
    '15s': '15s',
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '1h': '1h',
    '4H': '4h',
    '4h': '4h',
    '1D': '1d',
    '1d': '1d',
  };
  return intervalMap[interval] || '5m';
}

/**
 * Create MarketDataPort adapter that uses storage engine (DuckDB/ClickHouse)
 */
export function createMarketDataStorageAdapter(): MarketDataPort {
  const storageEngine = getStorageEngine();

  return {
    async fetchOhlcv(request: MarketDataOhlcvRequest): Promise<Candle[]> {
      // Convert port request to storage engine format
      const startTime = DateTime.fromSeconds(request.from, { zone: 'utc' });
      const endTime = DateTime.fromSeconds(request.to, { zone: 'utc' });
      const interval = mapInterval(request.interval);

      // Map chain
      const chain = request.chain === 'evm' ? 'ethereum' : request.chain;

      try {
        // Query storage engine (reads from DuckDB/ClickHouse)
        const candles = await storageEngine.getCandles(
          request.tokenAddress,
          chain,
          startTime,
          endTime,
          { interval, useCache: true }
        );

        logger.debug('Fetched candles from storage', {
          tokenAddress: request.tokenAddress,
          chain,
          interval,
          count: candles.length,
          from: startTime.toISO(),
          to: endTime.toISO(),
        });

        return candles;
      } catch (error) {
        logger.warn('Failed to fetch candles from storage', {
          tokenAddress: request.tokenAddress,
          chain,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },

    async fetchMetadata(
      request: MarketDataMetadataRequest
    ): Promise<{
      address: string;
      chain: Chain;
      name?: string;
      symbol?: string;
      decimals?: number;
      price?: number;
      logoURI?: string;
      priceChange24h?: number;
      volume24h?: number;
      marketCap?: number;
    } | null> {
      // Storage adapter doesn't provide metadata
      // Return basic info only
      return {
        address: request.tokenAddress,
        chain: request.chain ?? 'solana',
      };
    },

    async fetchHistoricalPriceAtTime(
      request: HistoricalPriceRequest
    ): Promise<HistoricalPriceResponse | null> {
      // For historical price, query candles around that time
      const targetTime = DateTime.fromSeconds(request.unixTime, { zone: 'utc' });
      const windowStart = targetTime.minus({ minutes: 5 });
      const windowEnd = targetTime.plus({ minutes: 5 });

      try {
        const candles = await storageEngine.getCandles(
          request.tokenAddress,
          request.chain ?? 'solana',
          windowStart,
          windowEnd,
          { interval: '1m', useCache: true }
        );

        if (candles.length === 0) {
          return null;
        }

        // Find closest candle to target time
        const targetTimestamp = request.unixTime;
        let closestCandle = candles[0];
        let minDiff = Math.abs(closestCandle.timestamp - targetTimestamp);

        for (const candle of candles) {
          const diff = Math.abs(candle.timestamp - targetTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestCandle = candle;
          }
        }

        return {
          unixTime: closestCandle.timestamp,
          value: closestCandle.close,
          price: closestCandle.close,
        };
      } catch (error) {
        logger.warn('Failed to fetch historical price from storage', {
          tokenAddress: request.tokenAddress,
          unixTime: request.unixTime,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
  };
}

