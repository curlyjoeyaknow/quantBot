"use strict";
/**
 * Structured Logging System
 * =========================
 * Centralized logging using Winston with structured output, log rotation,
 * and context propagation for better debugging and observability.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.winstonLogger = exports.Logger = exports.logger = exports.LogLevel = void 0;
const winston = __importStar(require("winston"));
// @ts-ignore - winston-daily-rotate-file has incorrect type definitions
const DailyRotateFile = require('winston-daily-rotate-file').default || require('winston-daily-rotate-file');
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Log levels
var LogLevel;
(function (LogLevel) {
    LogLevel["ERROR"] = "error";
    LogLevel["WARN"] = "warn";
    LogLevel["INFO"] = "info";
    LogLevel["DEBUG"] = "debug";
    LogLevel["TRACE"] = "trace";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
// Default configuration
const defaultConfig = {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    enableConsole: process.env.LOG_CONSOLE !== 'false',
    enableFile: process.env.LOG_FILE !== 'false',
    logDir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
};
// Create logs directory if it doesn't exist
if (defaultConfig.enableFile && defaultConfig.logDir) {
    if (!fs.existsSync(defaultConfig.logDir)) {
        fs.mkdirSync(defaultConfig.logDir, { recursive: true });
    }
}
// Custom format for structured logging
const structuredFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), winston.format.errors({ stack: true }), winston.format.splat(), winston.format.json());
// Console format for development (human-readable)
const consoleFormat = winston.format.combine(winston.format.colorize(), winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `[${timestamp}] ${level}: ${message}${metaStr ? '\n' + metaStr : ''}`;
}));
// Create transports array
const transports = [];
// Console transport
if (defaultConfig.enableConsole) {
    transports.push(new winston.transports.Console({
        format: process.env.NODE_ENV === 'production' ? structuredFormat : consoleFormat,
        level: defaultConfig.level,
    }));
}
// File transports with rotation
// Skip file logging in test environment to avoid file system issues
if (defaultConfig.enableFile && defaultConfig.logDir && process.env.NODE_ENV !== 'test') {
    try {
        // Error log file
        transports.push(new DailyRotateFile({
            filename: path.join(defaultConfig.logDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            format: structuredFormat,
            maxSize: defaultConfig.maxSize,
            maxFiles: defaultConfig.maxFiles,
            zippedArchive: true,
        }));
        // Combined log file
        transports.push(new DailyRotateFile({
            filename: path.join(defaultConfig.logDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            format: structuredFormat,
            maxSize: defaultConfig.maxSize,
            maxFiles: defaultConfig.maxFiles,
            zippedArchive: true,
        }));
    }
    catch (error) {
        // Silently fail in test environment
        const nodeEnv = process.env.NODE_ENV;
        if (nodeEnv && nodeEnv !== 'test') {
            console.error('Failed to initialize file transports:', error);
        }
    }
}
// Create Winston logger instance
const winstonLogger = winston.createLogger({
    level: defaultConfig.level,
    format: structuredFormat,
    defaultMeta: { service: 'quantbot' },
    transports,
    // Don't exit on handled exceptions
    exitOnError: false,
});
exports.winstonLogger = winstonLogger;
// Logger class with context support
class Logger {
    constructor() {
        this.context = {};
    }
    /**
     * Set context that will be included in all subsequent log messages
     */
    setContext(context) {
        this.context = { ...this.context, ...context };
    }
    /**
     * Clear context
     */
    clearContext() {
        this.context = {};
    }
    /**
     * Get current context
     */
    getContext() {
        return { ...this.context };
    }
    /**
     * Merge context for a single log call
     */
    mergeContext(additionalContext) {
        return { ...this.context, ...additionalContext };
    }
    /**
     * Log error message
     */
    error(message, error, context) {
        const logContext = this.mergeContext(context);
        if (error instanceof Error) {
            winstonLogger.error(message, {
                ...logContext,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                },
            });
        }
        else if (error) {
            winstonLogger.error(message, { ...logContext, error });
        }
        else {
            winstonLogger.error(message, logContext);
        }
    }
    /**
     * Log warning message
     */
    warn(message, context) {
        winstonLogger.warn(message, this.mergeContext(context));
    }
    /**
     * Log info message
     */
    info(message, context) {
        winstonLogger.info(message, this.mergeContext(context));
    }
    /**
     * Log debug message
     */
    debug(message, context) {
        winstonLogger.debug(message, this.mergeContext(context));
    }
    /**
     * Log trace message (most verbose)
     */
    trace(message, context) {
        // Winston doesn't have trace level, use debug
        winstonLogger.debug(message, { ...this.mergeContext(context), level: 'trace' });
    }
    /**
     * Create a child logger with persistent context
     */
    child(context) {
        const childLogger = new Logger();
        childLogger.setContext({ ...this.context, ...context });
        return childLogger;
    }
}
exports.Logger = Logger;
// Export singleton instance
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map