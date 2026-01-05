/**
 * @quantbot/utils - Shared utilities package
 *
 * Public API exports for the utils package
 *
 * Golden Path: This package exports only:
 * - Logger utilities
 * - Configuration loading
 * - Core domain types
 * - Error handling
 * - Utility functions (pumpfun, etc.)
 *
 * NO database code - that lives in @quantbot/storage
 */

// Logger and logging utilities
// Centralized logging system
export { logger, Logger, LogLevel, winstonLogger, createLogger } from './logger.js';
export type { LogContext } from './logger.js';
export {
  createRequestId,
  logRequest,
  logResponse,
  logError,
  logPerformance,
} from './logging-middleware.js';
export type { RequestContext } from './logging-middleware.js';

// Package-aware logging
export * from './logging/index.js';
export { createPackageLogger, LogHelpers } from './logging/index.js';
export { getLogLevel, isLogLevelEnabled } from './logging-config.js';
export { logger as loggerNextjs } from './logger-nextjs.js';

// Configuration loading
export * from './config/index.js';

// Shared types (legacy, kept for backward compatibility - re-exported from @quantbot/core)
// Note: SimulationEvent is exported from events, not types, to avoid conflicts
export * from './types.js';
export type { SimulationEvent } from '@quantbot/core'; // Re-export from core for consistency

// Error handling
export * from './errors.js';
export { handleError, retryWithBackoff } from './error-handler.js';

// Git utilities
export * from './git.js';

// Filesystem utilities
export { findWorkspaceRoot, clearWorkspaceRootCache } from './fs/workspace-root.js';

// Pump.fun utilities
export { PUMP_FUN_PROGRAM_ID, derivePumpfunBondingCurve } from './pumpfun.js';

// Address validation
export { isBase58, isSolanaAddress, isEvmAddress } from './addressValidation.js';

// Credit monitoring
export { creditMonitor } from './credit-monitor.js';

// DateTime Controller - ALWAYS use this for datetime operations
// NEVER use Date.now() or new Date() directly - use dt.now() or dt.fromTimestampMs()
export {
  DateTimeController,
  dt,
  isValidTimestampMs,
  isValidTimestampS,
  assertTimestampMs,
} from './datetime-controller.js';

// Events (kept for backward compatibility, but consider moving to services)
export * from './events/index.js';

// Python integration
export {
  PythonEngine,
  getPythonEngine,
  PythonManifestSchema,
  type PythonManifest,
  type PythonScriptOptions,
  type TelegramPipelineConfig,
  type DuckDBStorageConfig,
  type ClickHouseEngineConfig,
} from './python/python-engine.js';

// Test helpers
export { shouldRunDbStress, TEST_GATES } from './test-helpers/test-gating.js';

// Timing utilities
export {
  TimingContext,
  timed,
  timedSync,
  nowMs,
  formatMs,
  formatTimingParts,
  timedFunction,
} from './timing.js';
export type { TimingRecord, TimingSummary } from './timing.js';

// NOTE: Database utilities DEPRECATED - use @quantbot/storage instead
//
// ⚠️ DEPRECATION NOTICE:
// Database functions in this package are deprecated and will be removed in a future version.
// Please migrate to @quantbot/storage repositories. See MIGRATION_GUIDE.md for details.
//
// Database module removed - SQLite support has been removed.
// Use @quantbot/storage repositories (DuckDB repositories, etc.) instead.
// - live-trade-database.ts → ARCHIVED (see scripts/archive/live-trades/)
// - monitored-tokens-db.ts → ARCHIVED (see scripts/archive/monitored-tokens/)
// - live-trade-strategies.ts → ARCHIVED (see scripts/archive/live-trades/)
//
// See packages/utils/MIGRATION_GUIDE.md for complete migration instructions.
