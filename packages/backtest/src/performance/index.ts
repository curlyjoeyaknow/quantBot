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
} from '../sim/performance/monitor.js';

// Indicator calculation optimization
export { calculateIndicatorSeriesOptimized } from '../sim/performance/optimizations.js';

// Result caching
export {
  ResultCache,
  getResultCache,
  resetResultCache,
  type ResultCacheOptions,
} from '../sim/performance/result-cache.js';
