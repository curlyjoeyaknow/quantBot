/**
 * @quantbot/ohlcv - OHLCV Package (Offline-Only)
 *
 * Public API exports for OHLCV services.
 *
 * NOTE: This package is offline-only. It does NOT fetch candles from APIs.
 * For fetching candles, use @quantbot/jobs which orchestrates API calls.
 */

export * from './ohlcv-service';
export * from './ohlcv-engine';
export * from './ohlcv-query';
export * from './backfill-service';
export * from './ohlcv-storage';
// Export getCoverage for jobs to check coverage before fetching
export { getCoverage } from './ohlcv-storage';
// Note: candles.ts and historical-candles.ts contain deprecated API-calling functions
// They are not exported to prevent accidental use. Use @quantbot/api-clients instead.
