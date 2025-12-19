/**
 * OHLCV Cache Stub
 * Temporary stub for cache functionality
 * TODO: Replace with proper cache implementation from @quantbot/storage
 */

import type { Candle } from '@quantbot/core';

export const ohlcvCache = {
  get: (tokenAddress: string, startTime: Date, endTime: Date, interval: string): Candle[] | null => {
    return null;
  },

  set: (
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    data: Candle[],
    interval: string,
    ttl: number
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
    tokens: string[],
    startTime: Date,
    endTime: Date,
    fetchFunction: (token: string, start: Date, end: Date) => Promise<Candle[]>
  ): Promise<Map<string, Candle[]>> => {
    return new Map();
  },
};
