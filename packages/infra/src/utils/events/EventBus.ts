/**
 * Event Bus
 * =========
 * Centralized event bus for decoupled communication between components.
 * Provides type-safe event handling with middleware support.
 */

import { EventEmitter } from 'events';
import { logger } from '../logger.js';
import type { ApplicationEvent } from './EventTypes.js';

export interface EventMetadata {
  timestamp: number;
  source: string;
  correlationId?: string;
  userId?: number;
  sessionId?: string;
}

export interface BaseEvent {
  type: string;
  metadata: EventMetadata;
  data: unknown;
}

/**
 * Event handler function type
 * @template T - The data type for the event (defaults to unknown for type safety)
 */
export interface EventHandler<T = unknown> {
  (event: ApplicationEvent & { data: T }): Promise<void> | void;
}

export interface EventMiddleware {
  (event: ApplicationEvent, next: () => Promise<void>): Promise<void>;
}

/**
 * Centralized Event Bus
 * Manages event publishing, subscribing, and middleware
 */
export class EventBus extends EventEmitter {
  private middleware: EventMiddleware[] = [];
  private eventHistory: ApplicationEvent[] | null = null;
  private maxHistorySize: number = 1000;
  private handlerMap: Map<EventHandler<unknown>, (event: ApplicationEvent) => Promise<void>> =
    new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * @param options Configuration options for the event bus
   * @param options.enableHistory - Whether to enable event history (default: true)
   * @param options.maxHistorySize - Maximum number of events to keep in history (default: 1000)
   * @param options.cleanupIntervalMs - Interval in milliseconds for periodic cleanup (default: 60000, 0 to disable)
   */
  constructor(options?: {
    enableHistory?: boolean;
    maxHistorySize?: number;
    cleanupIntervalMs?: number;
  }) {
    super();
    this.setMaxListeners(100); // Increase max listeners for scalability

    const enableHistory = options?.enableHistory !== false; // Default to true for backward compatibility
    this.maxHistorySize = options?.maxHistorySize ?? 1000;

    if (enableHistory) {
      this.eventHistory = [];
    }

    // Set up periodic cleanup if enabled
    const cleanupIntervalMs = options?.cleanupIntervalMs ?? 60000; // Default 1 minute
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.performPeriodicCleanup();
      }, cleanupIntervalMs);
    }
  }

  /**
   * Add middleware to the event pipeline
   */
  public use(middleware: EventMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Publish an event to the bus
   * Awaits all async handlers before returning
   */
  public async publish<T extends ApplicationEvent = ApplicationEvent>(event: T): Promise<void> {
    try {
      // Add to history
      this.addToHistory(event);

      // Run through middleware pipeline
      const shouldEmit = await this.runMiddleware(event);

      // Only emit if middleware didn't block it
      if (shouldEmit !== false) {
        // Get all listeners for this event type
        const listeners = this.listeners(event.type) as Array<
          (event: ApplicationEvent) => Promise<void>
        >;

        // Await all async handlers
        if (listeners.length > 0) {
          await Promise.all(listeners.map((listener) => listener(event)));
        }

        logger.debug('Event published', { eventType: event.type, source: event.metadata.source });
      }
    } catch (error) {
      logger.error('Error publishing event', error as Error, {
        eventType: event.type,
        source: event.metadata.source,
      });
      this.emit('error', { event, error });
    }
  }

  /**
   * Subscribe to an event type
   */
  public subscribe<T extends ApplicationEvent = ApplicationEvent>(
    eventType: string,
    handler: EventHandler<T['data']>
  ): void {
    const wrappedHandler = async (event: ApplicationEvent) => {
      try {
        await handler(event);
      } catch (error) {
        logger.error('Error handling event', error as Error, { eventType });
        this.emit('error', { event, error });
      }
    };

    // Store mapping for unsubscribe
    this.handlerMap.set(handler as EventHandler<unknown>, wrappedHandler);
    this.on(eventType, wrappedHandler);
  }

  /**
   * Unsubscribe from an event type
   */
  public unsubscribe(eventType: string, handler: EventHandler): void {
    const wrappedHandler = this.handlerMap.get(handler);
    if (wrappedHandler) {
      this.off(eventType, wrappedHandler);
      this.handlerMap.delete(handler);
    }
  }

  /**
   * Subscribe to multiple event types
   */
  public subscribeMany<T extends ApplicationEvent = ApplicationEvent>(
    subscriptions: Array<{ eventType: string; handler: EventHandler<T['data']> }>
  ): void {
    subscriptions.forEach(({ eventType, handler }) => {
      this.subscribe(eventType, handler);
    });
  }

  /**
   * Get event history
   * Returns empty array if history is disabled
   */
  public getEventHistory(limit?: number): ApplicationEvent[] {
    if (!this.eventHistory) {
      return [];
    }
    const history = this.eventHistory.slice();
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get events by type
   * Returns empty array if history is disabled
   */
  public getEventsByType(eventType: string, limit?: number): ApplicationEvent[] {
    if (!this.eventHistory) {
      return [];
    }
    const events = this.eventHistory.filter((event) => event.type === eventType);
    return limit ? events.slice(-limit) : events;
  }

  /**
   * Get events by source
   * Returns empty array if history is disabled
   */
  public getEventsBySource(source: string, limit?: number): ApplicationEvent[] {
    if (!this.eventHistory) {
      return [];
    }
    const events = this.eventHistory.filter((event) => event.metadata.source === source);
    return limit ? events.slice(-limit) : events;
  }

  /**
   * Clear event history
   */
  public clearHistory(): void {
    if (this.eventHistory) {
      this.eventHistory = [];
    }
  }

  /**
   * Remove all event listeners
   * Useful for cleanup and preventing memory leaks
   */
  public removeAllListeners(eventName?: string | symbol): this {
    if (eventName) {
      super.removeAllListeners(eventName);
    } else {
      super.removeAllListeners();
      this.handlerMap.clear();
    }
    return this;
  }

  /**
   * Perform periodic cleanup of orphaned handlers and old history
   */
  private performPeriodicCleanup(): void {
    // Clean up handler map - remove handlers that are no longer registered
    const activeEventTypes = new Set<string>();
    this.eventNames().forEach((eventName) => {
      if (typeof eventName === 'string') {
        activeEventTypes.add(eventName);
      }
    });

    // Remove handlers that are no longer in use
    // Note: This is a conservative cleanup - we keep handlers that might still be needed
    // A more aggressive cleanup would require tracking handler usage

    // Clean up old history entries if history is getting too large
    if (this.eventHistory && this.eventHistory.length > this.maxHistorySize * 1.5) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Shutdown the event bus
   * Clears all listeners, history, and stops periodic cleanup
   */
  public shutdown(): void {
    // Stop periodic cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Remove all listeners
    this.removeAllListeners();

    // Clear history
    this.clearHistory();

    // Clear middleware
    this.middleware = [];

    logger.debug('EventBus shutdown complete');
  }

  /**
   * Get bus statistics
   */
  public getStats(): {
    totalEvents: number;
    eventTypes: string[];
    sources: string[];
    listeners: number;
    handlerCount: number;
  } {
    const eventTypes = this.eventHistory
      ? Array.from(new Set(this.eventHistory.map((e) => e.type)))
      : [];
    const sources = this.eventHistory
      ? Array.from(new Set(this.eventHistory.map((e) => e.metadata.source)))
      : [];

    return {
      totalEvents: this.eventHistory?.length ?? 0,
      eventTypes,
      sources,
      listeners: this.listenerCount('*'),
      handlerCount: this.handlerMap.size,
    };
  }

  /**
   * Run event through middleware pipeline
   * Returns false if middleware blocked the event, true otherwise
   */
  private async runMiddleware(event: ApplicationEvent): Promise<boolean> {
    let index = 0;
    let blocked = false;

    const next = async (): Promise<void> => {
      if (index < this.middleware.length) {
        const middleware = this.middleware[index++];
        await middleware(event, next);
      }
    };

    try {
      await next();
    } catch (error: unknown) {
      // If middleware throws a specific "blocked" error or returns early, mark as blocked
      const errorObj = error as { blocked?: boolean };
      if (errorObj?.blocked === true) {
        blocked = true;
      } else {
        throw error;
      }
    }

    return !blocked;
  }

  /**
   * Add event to history
   */
  private addToHistory(event: ApplicationEvent): void {
    if (!this.eventHistory) {
      return; // History disabled
    }

    this.eventHistory.push(event);

    // Trim history if it exceeds max size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }
}

/**
 * Event Factory
 * Creates properly formatted events with metadata
 */
export class EventFactory {
  private static correlationIdCounter = 0;

  /**
   * Create a new event
   * Note: For type-safe events, use the specific event type constructors
   */
  public static create<_T extends ApplicationEvent = ApplicationEvent>(
    type: string,
    data: unknown,
    source: string,
    options: {
      userId?: number;
      sessionId?: string;
      correlationId?: string;
    } = {}
  ): ApplicationEvent {
    const correlationId =
      options.correlationId || `evt_${++this.correlationIdCounter}_${Date.now()}`;

    return {
      type,
      data,
      metadata: {
        timestamp: Date.now(),
        source,
        correlationId,
        userId: options.userId,
        sessionId: options.sessionId,
      },
    } as ApplicationEvent;
  }

  /**
   * Create a user-related event
   */
  public static createUserEvent(
    type: string,
    data: unknown,
    source: string,
    userId: number,
    sessionId?: string
  ): ApplicationEvent {
    return this.create(type, data, source, { userId, sessionId });
  }

  /**
   * Create a system event
   */
  public static createSystemEvent(type: string, data: unknown, source: string): ApplicationEvent {
    return this.create(type, data, source);
  }
}

// Export singleton instance
export const eventBus = new EventBus();
