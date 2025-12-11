"use strict";
/**
 * Event Bus
 * =========
 * Centralized event bus for decoupled communication between components.
 * Provides type-safe event handling with middleware support.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventBus = exports.EventFactory = exports.EventBus = void 0;
const events_1 = require("events");
const logger_1 = require("../utils/logger");
/**
 * Centralized Event Bus
 * Manages event publishing, subscribing, and middleware
 */
class EventBus extends events_1.EventEmitter {
    constructor() {
        super();
        this.middleware = [];
        this.eventHistory = [];
        this.maxHistorySize = 1000;
        this.handlerMap = new Map();
        this.setMaxListeners(100); // Increase max listeners for scalability
    }
    /**
     * Add middleware to the event pipeline
     */
    use(middleware) {
        this.middleware.push(middleware);
    }
    /**
     * Publish an event to the bus
     */
    async publish(event) {
        try {
            // Add to history
            this.addToHistory(event);
            // Run through middleware pipeline
            const shouldEmit = await this.runMiddleware(event);
            // Only emit if middleware didn't block it
            if (shouldEmit !== false) {
                this.emit(event.type, event);
                logger_1.logger.debug('Event published', { eventType: event.type, source: event.metadata.source });
            }
        }
        catch (error) {
            logger_1.logger.error('Error publishing event', error, { eventType: event.type, source: event.metadata.source });
            this.emit('error', { event, error });
        }
    }
    /**
     * Subscribe to an event type
     */
    subscribe(eventType, handler) {
        const wrappedHandler = async (event) => {
            try {
                await handler(event);
            }
            catch (error) {
                logger_1.logger.error('Error handling event', error, { eventType });
                this.emit('error', { event, error });
            }
        };
        // Store mapping for unsubscribe
        this.handlerMap.set(handler, wrappedHandler);
        this.on(eventType, wrappedHandler);
    }
    /**
     * Unsubscribe from an event type
     */
    unsubscribe(eventType, handler) {
        const wrappedHandler = this.handlerMap.get(handler);
        if (wrappedHandler) {
            this.off(eventType, wrappedHandler);
            this.handlerMap.delete(handler);
        }
    }
    /**
     * Subscribe to multiple event types
     */
    subscribeMany(subscriptions) {
        subscriptions.forEach(({ eventType, handler }) => {
            this.subscribe(eventType, handler);
        });
    }
    /**
     * Get event history
     */
    getEventHistory(limit) {
        const history = this.eventHistory.slice();
        return limit ? history.slice(-limit) : history;
    }
    /**
     * Get events by type
     */
    getEventsByType(eventType, limit) {
        const events = this.eventHistory.filter(event => event.type === eventType);
        return limit ? events.slice(-limit) : events;
    }
    /**
     * Get events by source
     */
    getEventsBySource(source, limit) {
        const events = this.eventHistory.filter(event => event.metadata.source === source);
        return limit ? events.slice(-limit) : events;
    }
    /**
     * Clear event history
     */
    clearHistory() {
        this.eventHistory = [];
    }
    /**
     * Get bus statistics
     */
    getStats() {
        const eventTypes = Array.from(new Set(this.eventHistory.map(e => e.type)));
        const sources = Array.from(new Set(this.eventHistory.map(e => e.metadata.source)));
        return {
            totalEvents: this.eventHistory.length,
            eventTypes,
            sources,
            listeners: this.listenerCount('*')
        };
    }
    /**
     * Run event through middleware pipeline
     * Returns false if middleware blocked the event, true otherwise
     */
    async runMiddleware(event) {
        let index = 0;
        let blocked = false;
        const next = async () => {
            if (index < this.middleware.length) {
                const middleware = this.middleware[index++];
                await middleware(event, next);
            }
        };
        try {
            await next();
        }
        catch (error) {
            // If middleware throws a specific "blocked" error or returns early, mark as blocked
            if (error?.blocked === true) {
                blocked = true;
            }
            else {
                throw error;
            }
        }
        return !blocked;
    }
    /**
     * Add event to history
     */
    addToHistory(event) {
        this.eventHistory.push(event);
        // Trim history if it exceeds max size
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
        }
    }
}
exports.EventBus = EventBus;
/**
 * Event Factory
 * Creates properly formatted events with metadata
 */
class EventFactory {
    /**
     * Create a new event
     */
    static create(type, data, source, options = {}) {
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
    static createUserEvent(type, data, source, userId, sessionId) {
        return this.create(type, data, source, { userId, sessionId });
    }
    /**
     * Create a system event
     */
    static createSystemEvent(type, data, source) {
        return this.create(type, data, source);
    }
}
exports.EventFactory = EventFactory;
EventFactory.correlationIdCounter = 0;
// Export singleton instance
exports.eventBus = new EventBus();
//# sourceMappingURL=EventBus.js.map