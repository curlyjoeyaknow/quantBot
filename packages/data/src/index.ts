/**
 * @quantbot/data - Data Layer
 *
 * Consolidated data package combining:
 * - ohlcv: OHLCV candle data management and services
 * - ingestion: Data ingestion services for Telegram alerts and OHLCV data
 * - jobs: Online orchestration jobs for OHLCV fetching and data ingestion
 *
 * Import submodules directly for specific functionality:
 * - @quantbot/data/ohlcv
 * - @quantbot/data/ingestion
 * - @quantbot/data/jobs
 */

// Re-export all submodules
export * as ohlcv from './ohlcv/index.js';
export * as ingestion from './ingestion/index.js';
export * as jobs from './jobs/index.js';

