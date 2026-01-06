/**
 * OHLCV Cache Stub
 * Temporary stub for cache functionality
 * TODO: Replace with proper cache implementation from @quantbot/storage
 */

import type { Candle } from '@quantbot/core';

export const ohlcvCache = {
  get: (
    _tokenAddress: string,
    _startTime: Date,
    _endTime: Date,
    _interval: string
  ): Candle[] | null => {
    return null;
  },

  set: (
    _tokenAddress: string,
    _startTime: Date,
    _endTime: Date,
    _data: Candle[],
    _interval: string,
    _ttl: number
  ): void => {
    // No-op stub
  },

  clear: (): void => {
    // No-op stub
  },

  getStats: (): { hits: number; misses: number; size: number } => {
    return { hits: 0, misses: 0, size: 0 };
  },

  getCacheInfo: (): { size: number; maxSize: number } => {
    return { size: 0, maxSize: 10000 };
  },

  logStats: (): void => {
    // No-op stub
  },

  prefetchForSimulation: async (
    _tokens: string[],
    _startTime: Date,
    _endTime: Date,
    _fetchFunction: (token: string, start: Date, end: Date) => Promise<Candle[]>
  ): Promise<Map<string, Candle[]>> => {
    return new Map();
  },
};
