/**
 * Storage Integration
 * ===================
 * Exports for storage integration with simulation engine.
 */

export { createStorageSink, StorageSink } from './storage-sink';
export type { StorageSinkConfig } from './storage-sink';
export { ensureStrategyStored, generateStrategyName, hashStrategyConfig } from './strategy-storage';
export { calculateResultMetrics } from './metrics-calculator';
export { getResultCache, ResultCache } from './result-cache';
export type { ResultCacheConfig } from './result-cache';
export { createOrchestratorWithStorage } from './orchestrator-helper';
