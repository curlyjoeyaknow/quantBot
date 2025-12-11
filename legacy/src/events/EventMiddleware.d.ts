/**
 * Event Middleware
 * ===============
 * Middleware functions for the event bus to handle logging, metrics, and error handling.
 */
import { EventMiddleware } from './EventBus';
/**
 * Logging Middleware
 * Logs all events with appropriate levels
 */
export declare const loggingMiddleware: EventMiddleware;
/**
 * Metrics Middleware
 * Collects metrics about event processing
 */
export declare class MetricsMiddleware {
    private metrics;
    middleware: EventMiddleware;
    getMetrics(): Record<string, {
        count: number;
        avgTime: number;
        errorRate: number;
    }>;
    clearMetrics(): void;
}
/**
 * Error Handling Middleware
 * Provides centralized error handling for events
 */
export declare const errorHandlingMiddleware: EventMiddleware;
/**
 * Rate Limiting Middleware
 * Prevents event flooding
 */
export declare class RateLimitingMiddleware {
    private eventCounts;
    private readonly windowMs;
    private readonly maxEvents;
    constructor(windowMs?: number, maxEvents?: number);
    middleware: EventMiddleware;
}
/**
 * Validation Middleware
 * Validates event structure and required fields
 */
export declare const validationMiddleware: EventMiddleware;
/**
 * Correlation Middleware
 * Ensures correlation IDs are properly set
 */
export declare const correlationMiddleware: EventMiddleware;
/**
 * User Context Middleware
 * Adds user context to events when available
 */
export declare const userContextMiddleware: EventMiddleware;
/**
 * Performance Monitoring Middleware
 * Monitors event processing performance
 */
export declare class PerformanceMiddleware {
    private slowEventThreshold;
    constructor(slowEventThreshold?: number);
    middleware: EventMiddleware;
}
//# sourceMappingURL=EventMiddleware.d.ts.map