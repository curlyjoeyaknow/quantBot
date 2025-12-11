/**
 * Logging Configuration
 * =====================
 * Configuration and utilities for the logging system
 */
import { LogLevel } from './logger';
/**
 * Get log level from environment or default
 */
export declare function getLogLevel(): LogLevel;
/**
 * Check if logging is enabled for a specific level
 */
export declare function isLogLevelEnabled(level: LogLevel, currentLevel: LogLevel): boolean;
//# sourceMappingURL=logging-config.d.ts.map