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

// Export OHLCV slice export handler and utilities
export { exportOhlcvSliceHandler } from './handlers/export-ohlcv-slice.js';
export type { ExportOhlcvSliceArgs, ExportOhlcvSliceResult } from './handlers/export-ohlcv-slice.js';
export { validateCoverage, intervalToMs, getCoverageStatus } from './coverage/validator.js';
export type { CoverageMetrics, Gap } from './coverage/validator.js';
export { buildOhlcvQuery, validateQueryParams } from './clickhouse/query-builder.js';
export type { OhlcvQueryParams } from './clickhouse/query-builder.js';

// Note: candles.ts and historical-candles.ts contain deprecated API-calling functions
// They are not exported to prevent accidental use. Use @quantbot/api-clients instead.
