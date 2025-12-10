"use strict";
/**
 * Next.js Logger Adapter
 * ======================
 * Logger adapter for Next.js API routes and server components.
 * Provides the same structured logging interface as the main logger.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.NextJSLogger = void 0;
const logger_1 = require("./logger");
/**
 * Next.js-specific logger with request context support
 */
class NextJSLogger {
    /**
     * Create a logger with request context
     */
    static withRequest(requestId, additionalContext) {
        const contextLogger = logger_1.logger.child({
            requestId,
            ...additionalContext,
        });
        return contextLogger;
    }
    /**
     * Log error with Next.js context
     */
    static error(message, error, context) {
        logger_1.logger.error(message, error, context);
    }
    /**
     * Log warning with Next.js context
     */
    static warn(message, context) {
        logger_1.logger.warn(message, context);
    }
    /**
     * Log info with Next.js context
     */
    static info(message, context) {
        logger_1.logger.info(message, context);
    }
    /**
     * Log debug with Next.js context
     */
    static debug(message, context) {
        logger_1.logger.debug(message, context);
    }
}
exports.NextJSLogger = NextJSLogger;
/**
 * Export singleton for convenience
 */
exports.logger = NextJSLogger;
//# sourceMappingURL=logger-nextjs.js.map