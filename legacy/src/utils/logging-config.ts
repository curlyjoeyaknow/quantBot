/**
 * Logging Configuration
 * =====================
 * Configuration and utilities for the logging system
 */

import { LogLevel } from './logger';

/**
 * Get log level from environment or default
 */
export function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  
  if (envLevel === 'error') return LogLevel.ERROR;
  if (envLevel === 'warn') return LogLevel.WARN;
  if (envLevel === 'info') return LogLevel.INFO;
  if (envLevel === 'debug') return LogLevel.DEBUG;
  if (envLevel === 'trace') return LogLevel.TRACE;
  
  // Default based on environment
  return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
}

/**
 * Check if logging is enabled for a specific level
 */
export function isLogLevelEnabled(level: LogLevel, currentLevel: LogLevel): boolean {
  const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG, LogLevel.TRACE];
  const currentIndex = levels.indexOf(currentLevel);
  const checkIndex = levels.indexOf(level);
  return checkIndex <= currentIndex;
}

