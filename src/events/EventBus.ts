/**
 * Event Bus
 * =========
 * Centralized event bus for decoupled communication between components.
 * Provides type-safe event handling with middleware support.
 */

import { EventEmitter } from 'events';

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
  data: any;
}

export interface EventHandler<T = any> {
  (event: BaseEvent & { data: T }): Promise<void> | void;
}

export interface EventMiddleware {
  (event: BaseEvent, next: () => Promise<void>): Promise<void>;
}

/**
 * Centralized Event Bus
 * Manages event publishing, subscribing, and middleware
 */
export class EventBus extends EventEmitter {
  private middleware: EventMiddleware[] = [];
  private eventHistory: BaseEvent[] = [];
  private maxHistorySize: number = 1000;

  constructor() {
    super();
    this.setMaxListeners(100); // Increase max listeners for scalability
  }

  /**
   * Add middleware to the event pipeline
   */
  public use(middleware: EventMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Publish an event to the bus
   */
  public async publish<T = any>(event: BaseEvent & { data: T }): Promise<void> {
    try {
      // Add to history
      this.addToHistory(event);

      // Run through middleware pipeline
      await this.runMiddleware(event);

      // Emit the event
      this.emit(event.type, event);
      
      console.log(`Event published: ${event.type} from ${event.metadata.source}`);
    } catch (error) {
      console.error(`Error publishing event ${event.type}:`, error);
      this.emit('error', { event, error });
    }
  }

  /**
   * Subscribe to an event type
   */
  public subscribe<T = any>(eventType: string, handler: EventHandler<T>): void {
    this.on(eventType, async (event: BaseEvent & { data: T }) => {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Error handling event ${eventType}:`, error);
        this.emit('error', { event, error });
      }
    });
  }

  /**
   * Unsubscribe from an event type
   */
  public unsubscribe(eventType: string, handler: EventHandler): void {
    this.off(eventType, handler);
  }

  /**
   * Subscribe to multiple event types
   */
  public subscribeMany<T = any>(subscriptions: Array<{ eventType: string; handler: EventHandler<T> }>): void {
    subscriptions.forEach(({ eventType, handler }) => {
      this.subscribe(eventType, handler);
    });
  }

  /**
   * Get event history
   */
  public getEventHistory(limit?: number): BaseEvent[] {
    const history = this.eventHistory.slice();
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get events by type
   */
  public getEventsByType(eventType: string, limit?: number): BaseEvent[] {
    const events = this.eventHistory.filter(event => event.type === eventType);
    return limit ? events.slice(-limit) : events;
  }

  /**
   * Get events by source
   */
  public getEventsBySource(source: string, limit?: number): BaseEvent[] {
    const events = this.eventHistory.filter(event => event.metadata.source === source);
    return limit ? events.slice(-limit) : events;
  }

  /**
   * Clear event history
   */
  public clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get bus statistics
   */
  public getStats(): {
    totalEvents: number;
    eventTypes: string[];
    sources: string[];
    listeners: number;
  } {
    const eventTypes = [...new Set(this.eventHistory.map(e => e.type))];
    const sources = [...new Set(this.eventHistory.map(e => e.metadata.source))];
    
    return {
      totalEvents: this.eventHistory.length,
      eventTypes,
      sources,
      listeners: this.listenerCount('*')
    };
  }

  /**
   * Run event through middleware pipeline
   */
  private async runMiddleware(event: BaseEvent): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < this.middleware.length) {
        const middleware = this.middleware[index++];
        await middleware(event, next);
      }
    };

    await next();
  }

  /**
   * Add event to history
   */
  private addToHistory(event: BaseEvent): void {
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
   */
  public static create<T = any>(
    type: string,
    data: T,
    source: string,
    options: {
      userId?: number;
      sessionId?: string;
      correlationId?: string;
    } = {}
  ): BaseEvent & { data: T } {
    const correlationId = options.correlationId || `evt_${++this.correlationIdCounter}_${Date.now()}`;
    
    return {
      type,
      data,
      metadata: {
        timestamp: Date.now(),
        source,
        correlationId,
        userId: options.userId,
        sessionId: options.sessionId
      }
    };
  }

  /**
   * Create a user-related event
   */
  public static createUserEvent<T = any>(
    type: string,
    data: T,
    source: string,
    userId: number,
    sessionId?: string
  ): BaseEvent & { data: T } {
    return this.create(type, data, source, { userId, sessionId });
  }

  /**
   * Create a system event
   */
  public static createSystemEvent<T = any>(
    type: string,
    data: T,
    source: string
  ): BaseEvent & { data: T } {
    return this.create(type, data, source);
  }
}

// Export singleton instance
export const eventBus = new EventBus();
