/**
 * Event Middleware
 * ===============
 * Middleware functions for the event bus to handle logging, metrics, and error handling.
 */

import { EventMiddleware } from './EventBus';
import type { ApplicationEvent } from './EventTypes';
import { EventPriority, EVENT_PRIORITIES } from './EventTypes';
import { logger } from '../logger';

/**
 * Logging Middleware
 * Logs all events with appropriate levels
 */
export const loggingMiddleware: EventMiddleware = async (event: ApplicationEvent, next) => {
  const priority = EVENT_PRIORITIES[event.type] || EventPriority.NORMAL;
  const logLevel = priority >= EventPriority.HIGH ? 'warn' : 'info';

  logger[logLevel](`[EVENT] ${event.type} from ${event.metadata.source}`, {
    timestamp: new Date(event.metadata.timestamp).toISOString(),
    correlationId: event.metadata.correlationId,
    userId: event.metadata.userId,
    priority: EventPriority[priority],
  });

  await next();
};

/**
 * Metrics Middleware
 * Collects metrics about event processing
 */
export class MetricsMiddleware {
  private metrics: Map<
    string,
    { count: number; totalTime: number; errors: number; lastUpdated: number }
  > = new Map();
  private readonly maxMetrics: number;
  private readonly ttlMs: number;

  /**
   * @param maxMetrics Maximum number of event types to track (default: 1000)
   * @param ttlMs Time-to-live for metrics in milliseconds (default: 1 hour, 0 to disable)
   */
  constructor(maxMetrics: number = 1000, ttlMs: number = 3600000) {
    this.maxMetrics = maxMetrics;
    this.ttlMs = ttlMs;
  }

  public middleware: EventMiddleware = async (event: ApplicationEvent, next) => {
    const startTime = Date.now();
    const eventKey = event.type;

    // Clean up expired metrics periodically
    if (this.ttlMs > 0 && this.metrics.size > this.maxMetrics) {
      this.cleanupExpiredMetrics();
    }

    // Enforce max size limit
    if (this.metrics.size >= this.maxMetrics && !this.metrics.has(eventKey)) {
      // Remove oldest entry (simple FIFO - could be improved with LRU)
      const firstKey = this.metrics.keys().next().value;
      if (firstKey) {
        this.metrics.delete(firstKey);
      }
    }

    try {
      await next();

      // Update success metrics
      const current = this.metrics.get(eventKey) || {
        count: 0,
        totalTime: 0,
        errors: 0,
        lastUpdated: Date.now(),
      };
      current.count++;
      current.totalTime += Date.now() - startTime;
      current.lastUpdated = Date.now();
      this.metrics.set(eventKey, current);
    } catch (error) {
      // Update error metrics
      const current = this.metrics.get(eventKey) || {
        count: 0,
        totalTime: 0,
        errors: 0,
        lastUpdated: Date.now(),
      };
      current.errors++;
      current.lastUpdated = Date.now();
      this.metrics.set(eventKey, current);

      throw error;
    }
  };

  /**
   * Clean up expired metrics based on TTL
   */
  private cleanupExpiredMetrics(): void {
    if (this.ttlMs <= 0) {
      return;
    }

    const now = Date.now();
    for (const [key, value] of this.metrics.entries()) {
      if (now - value.lastUpdated > this.ttlMs) {
        this.metrics.delete(key);
      }
    }
  }

  public getMetrics(): Record<string, { count: number; avgTime: number; errorRate: number }> {
    // Clean up expired metrics before returning
    if (this.ttlMs > 0) {
      this.cleanupExpiredMetrics();
    }

    const result: Record<string, { count: number; avgTime: number; errorRate: number }> = {};

    for (const [eventType, metrics] of Array.from(this.metrics.entries())) {
      result[eventType] = {
        count: metrics.count,
        avgTime: metrics.count > 0 ? metrics.totalTime / metrics.count : 0,
        errorRate: metrics.count > 0 ? metrics.errors / metrics.count : 0,
      };
    }

    return result;
  }

  public clearMetrics(): void {
    this.metrics.clear();
  }
}

/**
 * Error Handling Middleware
 * Provides centralized error handling for events
 */
export const errorHandlingMiddleware: EventMiddleware = async (event: ApplicationEvent, next) => {
  try {
    await next();
  } catch (error) {
    logger.error(`[EVENT_ERROR] ${event.type} from ${event.metadata.source}`, error as Error);

    // Emit error event
    event.metadata.source = 'error-handler';
    // Note: We can't emit here as it would cause infinite recursion
    // Instead, we'll let the EventBus handle error emission

    throw error;
  }
};

/**
 * Rate Limiting Middleware
 * Prevents event flooding
 */
export class RateLimitingMiddleware {
  private eventCounts: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private cleanupCounter: number = 0;
  private readonly cleanupInterval: number = 100; // Clean up every 100 events

  constructor(windowMs: number = 60000, maxEvents: number = 100) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
  }

  public middleware: EventMiddleware = async (event: ApplicationEvent, next) => {
    const now = Date.now();
    const key = `${event.type}:${event.metadata.source}`;

    // Clean up expired windows periodically
    this.cleanupCounter++;
    if (this.cleanupCounter >= this.cleanupInterval) {
      this.cleanupCounter = 0;
      this.cleanupExpiredWindows(now);
    }

    const current = this.eventCounts.get(key);

    if (current) {
      if (now > current.resetTime) {
        // Reset window
        current.count = 1;
        current.resetTime = now + this.windowMs;
      } else {
        current.count++;

        if (current.count > this.maxEvents) {
          logger.warn(
            `[RATE_LIMIT] Event ${event.type} from ${event.metadata.source} rate limited`
          );
          const error: any = new Error('Rate limited');
          error.blocked = true;
          throw error; // Block processing
        }
      }
    } else {
      this.eventCounts.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
    }

    await next();
  };

  /**
   * Clean up expired rate limit windows
   */
  private cleanupExpiredWindows(now: number): void {
    for (const [key, value] of this.eventCounts.entries()) {
      if (now > value.resetTime) {
        this.eventCounts.delete(key);
      }
    }
  }

  /**
   * Manually trigger cleanup of expired windows
   */
  public cleanup(): void {
    this.cleanupExpiredWindows(Date.now());
  }
}

/**
 * Validation Middleware
 * Validates event structure and required fields
 */
export const validationMiddleware: EventMiddleware = async (event: ApplicationEvent, next) => {
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

  if (eventTime < now - maxAge || eventTime > now + 60000) {
    // 1 minute future tolerance
    throw new Error(`Invalid event timestamp: ${new Date(eventTime).toISOString()}`);
  }

  await next();
};

/**
 * Correlation Middleware
 * Ensures correlation IDs are properly set
 */
export const correlationMiddleware: EventMiddleware = async (event: ApplicationEvent, next) => {
  if (!event.metadata.correlationId) {
    event.metadata.correlationId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  await next();
};

/**
 * User Context Middleware
 * Adds user context to events when available
 */
export const userContextMiddleware: EventMiddleware = async (event: ApplicationEvent, next) => {
  // This middleware can be extended to add user context
  // For now, it just passes through
  await next();
};

/**
 * Performance Monitoring Middleware
 * Monitors event processing performance
 */
export class PerformanceMiddleware {
  private slowEventThreshold: number;

  constructor(slowEventThreshold: number = 1000) {
    this.slowEventThreshold = slowEventThreshold;
  }

  public middleware: EventMiddleware = async (event: ApplicationEvent, next) => {
    const startTime = Date.now();

    await next();

    const duration = Date.now() - startTime;

    if (duration > this.slowEventThreshold) {
      logger.warn(`[SLOW_EVENT] ${event.type} took ${duration}ms to process`, {
        eventType: event.type,
        duration,
      });
    }
  };
}
