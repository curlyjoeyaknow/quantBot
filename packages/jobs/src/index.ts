/**
 * @quantbot/jobs - Online Orchestration Jobs
 *
 * This package contains online orchestration jobs for:
 * - OHLCV fetching from external APIs
 * - Data ingestion workflows
 * - Rate limiting and circuit breakers
 * - Metrics emission
 *
 * IMPORTANT: This is the ONLY package allowed to:
 * - Import @quantbot/api-clients
 * - Make HTTP requests
 * - Access API keys
 *
 * This package MUST NOT be imported by:
 * - @quantbot/simulation
 * - @quantbot/ohlcv
 */

export * from './ohlcv-fetch-job';
export * from './ohlcv-ingestion-engine';
// Re-export OhlcvWorkItem from ingestion for convenience
export type { OhlcvWorkItem } from '@quantbot/ingestion';
