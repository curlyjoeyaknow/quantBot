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
export { logger, Logger, LogLevel, LogContext, winstonLogger, createLogger } from './logger';
export { createRequestId, logRequest, logResponse, logError, logPerformance, RequestContext } from './logging-middleware';

// Package-aware logging
export * from './logging';
export { createPackageLogger, LogHelpers } from './logging';
export { getLogLevel, isLogLevelEnabled } from './logging-config';
export { logger as loggerNextjs } from './logger-nextjs';

// Configuration loading
export * from './config';

// Core domain types (Golden Path)
export * from './types/core';

// Shared types (legacy, kept for backward compatibility)
export * from './types';

// Error handling
export * from './errors';
export { handleError, retryWithBackoff } from './error-handler';

// Pump.fun utilities
export { PUMP_FUN_PROGRAM_ID, derivePumpfunBondingCurve } from './pumpfun';

// Credit monitoring
export { creditMonitor } from './credit-monitor';

// Events (kept for backward compatibility, but consider moving to services)
export * from './events';

// Database helpers (legacy compatibility)
export * from './database';

// NOTE: Database utilities removed - use @quantbot/storage instead
// - database.ts → moved to storage repositories
// - caller-database.ts → moved to storage repositories
// - live-trade-database.ts → moved to storage repositories
// - monitored-tokens-db.ts → moved to storage repositories
// - live-trade-strategies.ts → kept for now (may move to services)
