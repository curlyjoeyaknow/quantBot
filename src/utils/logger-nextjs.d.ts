/**
 * Next.js Logger Adapter
 * ======================
 * Logger adapter for Next.js API routes and server components.
 * Provides the same structured logging interface as the main logger.
 */
import { LogContext } from './logger';
/**
 * Next.js-specific logger with request context support
 */
export declare class NextJSLogger {
    /**
     * Create a logger with request context
     */
    static withRequest(requestId: string, additionalContext?: LogContext): import("./logger").Logger;
    /**
     * Log error with Next.js context
     */
    static error(message: string, error?: Error | unknown, context?: LogContext): void;
    /**
     * Log warning with Next.js context
     */
    static warn(message: string, context?: LogContext): void;
    /**
     * Log info with Next.js context
     */
    static info(message: string, context?: LogContext): void;
    /**
     * Log debug with Next.js context
     */
    static debug(message: string, context?: LogContext): void;
}
/**
 * Export singleton for convenience
 */
export declare const logger: typeof NextJSLogger;
//# sourceMappingURL=logger-nextjs.d.ts.map