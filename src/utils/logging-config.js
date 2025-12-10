"use strict";
/**
 * Logging Configuration
 * =====================
 * Configuration and utilities for the logging system
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLogLevel = getLogLevel;
exports.isLogLevelEnabled = isLogLevelEnabled;
const logger_1 = require("./logger");
/**
 * Get log level from environment or default
 */
function getLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel === 'error')
        return logger_1.LogLevel.ERROR;
    if (envLevel === 'warn')
        return logger_1.LogLevel.WARN;
    if (envLevel === 'info')
        return logger_1.LogLevel.INFO;
    if (envLevel === 'debug')
        return logger_1.LogLevel.DEBUG;
    if (envLevel === 'trace')
        return logger_1.LogLevel.TRACE;
    // Default based on environment
    return process.env.NODE_ENV === 'production' ? logger_1.LogLevel.INFO : logger_1.LogLevel.DEBUG;
}
/**
 * Check if logging is enabled for a specific level
 */
function isLogLevelEnabled(level, currentLevel) {
    const levels = [logger_1.LogLevel.ERROR, logger_1.LogLevel.WARN, logger_1.LogLevel.INFO, logger_1.LogLevel.DEBUG, logger_1.LogLevel.TRACE];
    const currentIndex = levels.indexOf(currentLevel);
    const checkIndex = levels.indexOf(level);
    return checkIndex <= currentIndex;
}
//# sourceMappingURL=logging-config.js.map