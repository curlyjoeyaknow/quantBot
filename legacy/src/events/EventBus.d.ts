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
    (event: BaseEvent & {
        data: T;
    }): Promise<void> | void;
}
export interface EventMiddleware {
    (event: BaseEvent, next: () => Promise<void>): Promise<void>;
}
/**
 * Centralized Event Bus
 * Manages event publishing, subscribing, and middleware
 */
export declare class EventBus extends EventEmitter {
    private middleware;
    private eventHistory;
    private maxHistorySize;
    private handlerMap;
    constructor();
    /**
     * Add middleware to the event pipeline
     */
    use(middleware: EventMiddleware): void;
    /**
     * Publish an event to the bus
     */
    publish<T = any>(event: BaseEvent & {
        data: T;
    }): Promise<void>;
    /**
     * Subscribe to an event type
     */
    subscribe<T = any>(eventType: string, handler: EventHandler<T>): void;
    /**
     * Unsubscribe from an event type
     */
    unsubscribe(eventType: string, handler: EventHandler): void;
    /**
     * Subscribe to multiple event types
     */
    subscribeMany<T = any>(subscriptions: Array<{
        eventType: string;
        handler: EventHandler<T>;
    }>): void;
    /**
     * Get event history
     */
    getEventHistory(limit?: number): BaseEvent[];
    /**
     * Get events by type
     */
    getEventsByType(eventType: string, limit?: number): BaseEvent[];
    /**
     * Get events by source
     */
    getEventsBySource(source: string, limit?: number): BaseEvent[];
    /**
     * Clear event history
     */
    clearHistory(): void;
    /**
     * Get bus statistics
     */
    getStats(): {
        totalEvents: number;
        eventTypes: string[];
        sources: string[];
        listeners: number;
    };
    /**
     * Run event through middleware pipeline
     * Returns false if middleware blocked the event, true otherwise
     */
    private runMiddleware;
    /**
     * Add event to history
     */
    private addToHistory;
}
/**
 * Event Factory
 * Creates properly formatted events with metadata
 */
export declare class EventFactory {
    private static correlationIdCounter;
    /**
     * Create a new event
     */
    static create<T = any>(type: string, data: T, source: string, options?: {
        userId?: number;
        sessionId?: string;
        correlationId?: string;
    }): BaseEvent & {
        data: T;
    };
    /**
     * Create a user-related event
     */
    static createUserEvent<T = any>(type: string, data: T, source: string, userId: number, sessionId?: string): BaseEvent & {
        data: T;
    };
    /**
     * Create a system event
     */
    static createSystemEvent<T = any>(type: string, data: T, source: string): BaseEvent & {
        data: T;
    };
}
export declare const eventBus: EventBus;
//# sourceMappingURL=EventBus.d.ts.map