/**
 * Structured Logging System
 * =========================
 * Centralized logging using Winston with structured output, log rotation,
 * and context propagation for better debugging and observability.
 */
import * as winston from 'winston';
export declare enum LogLevel {
    ERROR = "error",
    WARN = "warn",
    INFO = "info",
    DEBUG = "debug",
    TRACE = "trace"
}
export interface LogContext {
    userId?: number | string;
    requestId?: string;
    tokenAddress?: string;
    callerName?: string;
    strategy?: string;
    sessionId?: string;
    [key: string]: any;
}
declare const winstonLogger: winston.Logger;
declare class Logger {
    private context;
    private namespace;
    /**
     * Create a logger with a specific namespace (package name)
     */
    constructor(namespace?: string);
    /**
     * Set context that will be included in all subsequent log messages
     */
    setContext(context: LogContext): void;
    /**
     * Clear context
     */
    clearContext(): void;
    /**
     * Get current context
     */
    getContext(): LogContext;
    /**
     * Get the namespace for this logger
     */
    getNamespace(): string;
    /**
     * Merge context for a single log call, including namespace
     */
    private mergeContext;
    /**
     * Log error message
     */
    error(message: string, error?: Error | unknown, context?: LogContext): void;
    /**
     * Log warning message
     */
    warn(message: string, context?: LogContext): void;
    /**
     * Log info message
     */
    info(message: string, context?: LogContext): void;
    /**
     * Log debug message
     */
    debug(message: string, context?: LogContext): void;
    /**
     * Log trace message (most verbose)
     */
    trace(message: string, context?: LogContext): void;
    /**
     * Create a child logger with persistent context
     */
    child(context: LogContext): Logger;
}
export declare function createLogger(packageName: string): Logger;
export declare const logger: Logger;
export { Logger };
export { winstonLogger };
//# sourceMappingURL=logger.d.ts.map