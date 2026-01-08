/**
 * Performance Monitoring and Caching
 *
 * Re-exports simulation's performance utilities for backtest usage.
 */

// Performance monitoring
export {
  getPerformanceMonitor,
  PerformanceMonitor,
  type PerformanceMetrics,
} from '@quantbot/simulation';

// Indicator calculation optimization
export { calculateIndicatorSeriesOptimized } from '@quantbot/simulation';

// Result caching
export {
  ResultCache,
  getResultCache,
  resetResultCache,
  type ResultCacheOptions,
} from '@quantbot/simulation';
