"use strict";
/**
 * Event Middleware
 * ===============
 * Middleware functions for the event bus to handle logging, metrics, and error handling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceMiddleware = exports.userContextMiddleware = exports.correlationMiddleware = exports.validationMiddleware = exports.RateLimitingMiddleware = exports.errorHandlingMiddleware = exports.MetricsMiddleware = exports.loggingMiddleware = void 0;
const EventTypes_1 = require("./EventTypes");
const logger_1 = require("../utils/logger");
/**
 * Logging Middleware
 * Logs all events with appropriate levels
 */
const loggingMiddleware = async (event, next) => {
    const priority = EventTypes_1.EVENT_PRIORITIES[event.type] || EventTypes_1.EventPriority.NORMAL;
    const logLevel = priority >= EventTypes_1.EventPriority.HIGH ? 'warn' : 'info';
    logger_1.logger[logLevel](`[EVENT] ${event.type} from ${event.metadata.source}`, {
        timestamp: new Date(event.metadata.timestamp).toISOString(),
        correlationId: event.metadata.correlationId,
        userId: event.metadata.userId,
        priority: EventTypes_1.EventPriority[priority]
    });
    await next();
};
exports.loggingMiddleware = loggingMiddleware;
/**
 * Metrics Middleware
 * Collects metrics about event processing
 */
class MetricsMiddleware {
    constructor() {
        this.metrics = new Map();
        this.middleware = async (event, next) => {
            const startTime = Date.now();
            const eventKey = event.type;
            try {
                await next();
                // Update success metrics
                const current = this.metrics.get(eventKey) || { count: 0, totalTime: 0, errors: 0 };
                current.count++;
                current.totalTime += Date.now() - startTime;
                this.metrics.set(eventKey, current);
            }
            catch (error) {
                // Update error metrics
                const current = this.metrics.get(eventKey) || { count: 0, totalTime: 0, errors: 0 };
                current.errors++;
                this.metrics.set(eventKey, current);
                throw error;
            }
        };
    }
    getMetrics() {
        const result = {};
        for (const [eventType, metrics] of Array.from(this.metrics.entries())) {
            result[eventType] = {
                count: metrics.count,
                avgTime: metrics.count > 0 ? metrics.totalTime / metrics.count : 0,
                errorRate: metrics.count > 0 ? metrics.errors / metrics.count : 0
            };
        }
        return result;
    }
    clearMetrics() {
        this.metrics.clear();
    }
}
exports.MetricsMiddleware = MetricsMiddleware;
/**
 * Error Handling Middleware
 * Provides centralized error handling for events
 */
const errorHandlingMiddleware = async (event, next) => {
    try {
        await next();
    }
    catch (error) {
        logger_1.logger.error(`[EVENT_ERROR] ${event.type} from ${event.metadata.source}`, error);
        // Emit error event
        event.metadata.source = 'error-handler';
        // Note: We can't emit here as it would cause infinite recursion
        // Instead, we'll let the EventBus handle error emission
        throw error;
    }
};
exports.errorHandlingMiddleware = errorHandlingMiddleware;
/**
 * Rate Limiting Middleware
 * Prevents event flooding
 */
class RateLimitingMiddleware {
    constructor(windowMs = 60000, maxEvents = 100) {
        this.eventCounts = new Map();
        this.middleware = async (event, next) => {
            const now = Date.now();
            const key = `${event.type}:${event.metadata.source}`;
            const current = this.eventCounts.get(key);
            if (current) {
                if (now > current.resetTime) {
                    // Reset window
                    current.count = 1;
                    current.resetTime = now + this.windowMs;
                }
                else {
                    current.count++;
                    if (current.count > this.maxEvents) {
                        logger_1.logger.warn(`[RATE_LIMIT] Event ${event.type} from ${event.metadata.source} rate limited`);
                        const error = new Error('Rate limited');
                        error.blocked = true;
                        throw error; // Block processing
                    }
                }
            }
            else {
                this.eventCounts.set(key, {
                    count: 1,
                    resetTime: now + this.windowMs
                });
            }
            await next();
        };
        this.windowMs = windowMs;
        this.maxEvents = maxEvents;
    }
}
exports.RateLimitingMiddleware = RateLimitingMiddleware;
/**
 * Validation Middleware
 * Validates event structure and required fields
 */
const validationMiddleware = async (event, next) => {
    // Validate required fields
    if (!event.type || !event.metadata || !event.data) {
        throw new Error('Invalid event structure: missing required fields');
    }
    if (!event.metadata.timestamp || !event.metadata.source) {
        throw new Error('Invalid event metadata: missing timestamp or source');
    }
    // Validate timestamp is reasonable (not too old or in the future)
    const now = Date.now();
    const eventTime = event.metadata.timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (eventTime < now - maxAge || eventTime > now + 60000) { // 1 minute future tolerance
        throw new Error(`Invalid event timestamp: ${new Date(eventTime).toISOString()}`);
    }
    await next();
};
exports.validationMiddleware = validationMiddleware;
/**
 * Correlation Middleware
 * Ensures correlation IDs are properly set
 */
const correlationMiddleware = async (event, next) => {
    if (!event.metadata.correlationId) {
        event.metadata.correlationId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    await next();
};
exports.correlationMiddleware = correlationMiddleware;
/**
 * User Context Middleware
 * Adds user context to events when available
 */
const userContextMiddleware = async (event, next) => {
    // This middleware can be extended to add user context
    // For now, it just passes through
    await next();
};
exports.userContextMiddleware = userContextMiddleware;
/**
 * Performance Monitoring Middleware
 * Monitors event processing performance
 */
class PerformanceMiddleware {
    constructor(slowEventThreshold = 1000) {
        this.middleware = async (event, next) => {
            const startTime = Date.now();
            await next();
            const duration = Date.now() - startTime;
            if (duration > this.slowEventThreshold) {
                logger_1.logger.warn(`[SLOW_EVENT] ${event.type} took ${duration}ms to process`, { eventType: event.type, duration });
            }
        };
        this.slowEventThreshold = slowEventThreshold;
    }
}
exports.PerformanceMiddleware = PerformanceMiddleware;
//# sourceMappingURL=EventMiddleware.js.map