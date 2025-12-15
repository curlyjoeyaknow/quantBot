/**
 * @quantbot/monitoring - Live Token Monitoring Package
 * =====================================================
 *
 * Real-time monitoring of tokens, live alerts, and call ingestion.
 * For historical analytics, see @quantbot/analytics.
 */

// =========================================================================
// Monitoring Engine (Core orchestration)
// =========================================================================
export {
  MonitoringEngine,
  getMonitoringEngine,
  type MonitoringEngineConfig,
  type MonitoringEngineStatus,
} from './engine/MonitoringEngine';

// =========================================================================
// Live Monitoring Services
// =========================================================================

// Helius monitor
export { HeliusMonitor } from './helius-monitor';

// Stream recorder
export { heliusStreamRecorder } from './stream/helius-recorder';

// Backfill service
export { heliusBackfillService } from './backfill/helius-backfill-service';

// Pump.fun lifecycle tracker
export { pumpfunLifecycleTracker } from './pumpfun/pumpfun-lifecycle-tracker';

// OHLCV aggregator
export { OhlcvAggregator } from './aggregation/ohlcv-aggregator';

// Monitoring services
export * from './brook-call-ingestion';
export * from './curlyjoe-call-ingestion';
export * from './CAMonitoringService';
export * from './live-trade-alert-service';
export * from './tenkan-kijun-alert-service';
export * from './start-live-trade-alerts';
export * from './start-tenkan-kijun-alerts';
export * from './dex-transaction-parser';
export * from './pump-idl-decoder';

// Package logger
export { logger } from './logger';

// =========================================================================
// Note: Historical analytics moved to @quantbot/analytics
// =========================================================================
