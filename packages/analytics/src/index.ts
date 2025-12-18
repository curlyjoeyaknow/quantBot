/**
 * @quantbot/analytics - Historical Analytics Package
 * ===================================================
 *
 * Provides historical analytics and performance metrics for trading calls.
 * Separate from @quantbot/monitoring which handles live token monitoring.
 */

// Types
export * from './types';

// Core engine
export {
  AnalyticsEngine,
  getAnalyticsEngine,
  type AnalyticsOptions,
  type AnalyticsResult,
} from './engine/AnalyticsEngine';

// Loaders
export { CallDataLoader, type LoadCallsOptions } from './loaders/CallDataLoader';

// Aggregators
export { MetricsAggregator } from './aggregators/MetricsAggregator';

// Utilities
export {
  calculateAthFromCandles,
  calculateAthFromCandleObjects,
  calculatePeriodAthAtl,
  calculatePeriodAthAtlFromCandles,
} from './utils/ath-calculator';
export type { AthResult, PeriodAthAtlResult, ReEntryOpportunity } from './utils/ath-calculator';

// Period metrics utilities
export {
  enrichCallWithPeriodMetrics,
  enrichCallsWithPeriodMetrics,
  analyzeReEntryOpportunities,
} from './utils/period-metrics';
export type { EnrichPeriodMetricsOptions, ReEntryAnalysis } from './utils/period-metrics';

// Analytics service
export {
  AnalyticsService,
  CallerAnalysisResultSchema,
  MintAnalysisResultSchema,
  CorrelationAnalysisResultSchema,
  AnalyticsResultSchema,
} from './analytics-service';
export type {
  CallerAnalysisResult,
  MintAnalysisResult,
  CorrelationAnalysisResult,
  AnalyticsConfig,
} from './analytics-service';
// Note: AnalyticsResult from analytics-service conflicts with AnalyticsResult from AnalyticsEngine
// Use AnalyticsResult from AnalyticsEngine for the main analytics results
// For Python-based analytics results, use the specific types: CallerAnalysisResult, MintAnalysisResult, etc.
