/**
 * @quantbot/ohlcv - OHLCV Package (Offline-Only)
 *
 * Public API exports for OHLCV services.
 *
 * NOTE: This package is offline-only. It does NOT fetch candles from APIs.
 * For fetching candles, use @quantbot/jobs which orchestrates API calls.
 */

export * from './ohlcv-service.js';
export * from './ohlcv-engine.js';
export * from './ohlcv-query.js';
// export * from './backfill-service.js'; // TEMPORARILY COMMENTED OUT - has build errors
export * from './ohlcv-storage.js';
// Export getCoverage and storeCandles for jobs
export { getCoverage, storeCandles } from './ohlcv-storage.js';
// Note: candles.ts and historical-candles.ts contain deprecated API-calling functions
// They are not exported to prevent accidental use. Use @quantbot/api-clients instead.
