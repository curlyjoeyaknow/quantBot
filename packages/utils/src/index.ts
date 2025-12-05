/**
 * @quantbot/utils - Shared utilities package
 * 
 * Public API exports for the utils package
 */

// Logger and logging utilities
export { logger, Logger, LogLevel, LogContext } from './logger';
export { winstonLogger } from './logger';
export { createRequestId, logRequest, logResponse, logError, logPerformance, RequestContext } from './logging-middleware';
export { getLogLevel, isLogLevelEnabled } from './logging-config';
export { logger as loggerNextjs } from './logger-nextjs';

// Database utilities
export * from './database';

// Error handling
export * from './errors';
export { handleError } from './error-handler';

// Shared types
export * from './types';

// Pump.fun utilities
export { PUMP_FUN_PROGRAM_ID, derivePumpfunBondingCurve } from './pumpfun';

// Credit monitoring
export { CreditMonitor } from './credit-monitor';

// Caller database utilities
export * from './caller-database';

// Live trade utilities
export * from './live-trade-database';
export * from './live-trade-strategies';

// Monitored tokens
export * from './monitored-tokens-db';

// Historical candles
// COMMENTED OUT: This has dependencies on external services and should be moved to @quantbot/services
// export { fetchHistoricalCandles } from './fetch-historical-candles';

// Repeat simulation helper
// COMMENTED OUT: This has dependencies on bot-specific types and should be moved to @quantbot/bot
// export { RepeatSimulationHelper } from './RepeatSimulationHelper';

