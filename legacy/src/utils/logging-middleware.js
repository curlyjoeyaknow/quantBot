"use strict";
/**
 * Logging Middleware
 * ==================
 * Middleware utilities for request/response logging and context propagation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestId = createRequestId;
exports.logRequest = logRequest;
exports.logResponse = logResponse;
exports.logError = logError;
exports.logPerformance = logPerformance;
const logger_1 = require("./logger");
const crypto_1 = require("crypto");
/**
 * Create request ID for tracking
 */
function createRequestId() {
    return (0, crypto_1.randomBytes)(16).toString('hex');
}
/**
 * Log incoming request
 */
function logRequest(context) {
    logger_1.logger.info('Incoming request', {
        method: context.method,
        path: context.path,
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
    });
}
/**
 * Log outgoing response
 */
function logResponse(context) {
    const level = context.statusCode && context.statusCode >= 400 ? 'warn' : 'info';
    logger_1.logger[level]('Request completed', {
        method: context.method,
        path: context.path,
        statusCode: context.statusCode,
        duration: context.duration,
        requestId: context.requestId,
    });
}
/**
 * Log error with request context
 */
function logError(error, context) {
    logger_1.logger.error('Request error', error, {
        method: context.method,
        path: context.path,
        requestId: context.requestId,
        statusCode: context.statusCode,
    });
}
/**
 * Performance logging decorator
 */
function logPerformance(fn, operation, context) {
    return (async (...args) => {
        const startTime = Date.now();
        const requestId = context?.requestId || createRequestId();
        logger_1.logger.debug(`Starting ${operation}`, { ...context, requestId });
        try {
            const result = await fn(...args);
            const duration = Date.now() - startTime;
            logger_1.logger.debug(`Completed ${operation}`, {
                ...context,
                requestId,
                duration,
                success: true,
            });
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger_1.logger.error(`Failed ${operation}`, error, {
                ...context,
                requestId,
                duration,
                success: false,
            });
            throw error;
        }
    });
}
//# sourceMappingURL=logging-middleware.js.map