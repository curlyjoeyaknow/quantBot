/**
 * API Stubs
 * ==========
 * Temporary stub implementations for external dependencies.
 * 
 * TODO: Replace these with proper implementations:
 * - Create @quantbot/external-apis package for birdeyeClient
 * - Move cache implementation to @quantbot/storage
 */

// Birdeye API Client Stub
export const birdeyeClient = {
  getTokenMetadata: async (mint: string, chain: string): Promise<any> => {
    return null;
  },
  
  fetchOHLCVData: async (
    mint: string,
    startTime: Date,
    endTime: Date,
    interval: string
  ): Promise<{ items: any[] }> => {
    return { items: [] };
  },
  
  getAPIKeyUsage: async (): Promise<{ used: number; limit: number; remaining: number }> => {
    return { used: 0, limit: 1000000, remaining: 1000000 };
  }
};

// OHLCV Cache Stub
export const ohlcvCache = {
  get: (
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string
  ): any[] | null => {
    return null;
  },
  
  set: (
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    data: any[],
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
    fetchFunction: (token: string, start: Date, end: Date) => Promise<any[]>
  ): Promise<Map<string, any[]>> => {
    return new Map();
  }
};
