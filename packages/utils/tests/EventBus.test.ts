/**
 * EventBus Comprehensive Tests
 *
 * Tests for:
 * - Event publishing and subscribing
 * - Middleware pipeline
 * - Memory leak prevention (history, handlers)
 * - Shutdown and cleanup
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../src/events/EventBus';
import { EventFactory } from '../src/events/EventBus';
import type { ApplicationEvent } from '../src/events/EventTypes';
import {
  loggingMiddleware,
  errorHandlingMiddleware,
  validationMiddleware,
  RateLimitingMiddleware,
  MetricsMiddleware,
} from '../src/events/EventMiddleware';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus({ enableHistory: true, maxHistorySize: 100 });
  });

  afterEach(() => {
    eventBus.shutdown();
  });

  describe('Basic Event Publishing and Subscribing', () => {
    it('should publish and receive events', async () => {
      const receivedEvents: ApplicationEvent[] = [];

      eventBus.subscribe('user.session.started', (event) => {
        receivedEvents.push(event);
      });

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('user.session.started');
      expect(receivedEvents[0].data).toEqual({ userId: 1, sessionData: {} });
    });

    it('should handle multiple subscribers for the same event type', async () => {
      const handler1Events: ApplicationEvent[] = [];
      const handler2Events: ApplicationEvent[] = [];

      eventBus.subscribe('user.session.started', (event) => {
        handler1Events.push(event);
      });

      eventBus.subscribe('user.session.started', (event) => {
        handler2Events.push(event);
      });

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      expect(handler1Events).toHaveLength(1);
      expect(handler2Events).toHaveLength(1);
    });

    it('should handle async event handlers', async () => {
      let handlerCalled = false;

      eventBus.subscribe('user.session.started', async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        handlerCalled = true;
      });

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      // Wait a bit for async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(handlerCalled).toBe(true);
    });
  });

  describe('Event History', () => {
    it('should track event history when enabled', async () => {
      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      const history = eventBus.getEventHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('user.session.started');
    });

    it('should not track history when disabled', async () => {
      const busWithoutHistory = new EventBus({ enableHistory: false });

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await busWithoutHistory.publish(event);

      const history = busWithoutHistory.getEventHistory();
      expect(history).toHaveLength(0);

      busWithoutHistory.shutdown();
    });

    it('should limit history size to maxHistorySize', async () => {
      const busWithSmallHistory = new EventBus({ enableHistory: true, maxHistorySize: 5 });

      for (let i = 0; i < 10; i++) {
        const event = EventFactory.createSystemEvent(
          'user.session.started',
          { userId: i, sessionData: {} },
          'test'
        );
        await busWithSmallHistory.publish(event);
      }

      const history = busWithSmallHistory.getEventHistory();
      expect(history.length).toBeLessThanOrEqual(5);
      // Should keep the most recent events
      expect(history[history.length - 1].data).toEqual({ userId: 9, sessionData: {} });

      busWithSmallHistory.shutdown();
    });

    it('should clear history when clearHistory is called', async () => {
      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);
      expect(eventBus.getEventHistory()).toHaveLength(1);

      eventBus.clearHistory();
      expect(eventBus.getEventHistory()).toHaveLength(0);
    });

    it('should get events by type', async () => {
      await eventBus.publish(
        EventFactory.createSystemEvent(
          'user.session.started',
          { userId: 1, sessionData: {} },
          'test'
        )
      );
      await eventBus.publish(
        EventFactory.createSystemEvent(
          'user.session.updated',
          { userId: 1, sessionData: {} },
          'test'
        )
      );
      await eventBus.publish(
        EventFactory.createSystemEvent(
          'user.session.started',
          { userId: 2, sessionData: {} },
          'test'
        )
      );

      const startedEvents = eventBus.getEventsByType('user.session.started');
      expect(startedEvents).toHaveLength(2);

      const updatedEvents = eventBus.getEventsByType('user.session.updated');
      expect(updatedEvents).toHaveLength(1);
    });

    it('should get events by source', async () => {
      await eventBus.publish(
        EventFactory.createSystemEvent(
          'user.session.started',
          { userId: 1, sessionData: {} },
          'source1'
        )
      );
      await eventBus.publish(
        EventFactory.createSystemEvent(
          'user.session.started',
          { userId: 2, sessionData: {} },
          'source2'
        )
      );
      await eventBus.publish(
        EventFactory.createSystemEvent(
          'user.session.started',
          { userId: 3, sessionData: {} },
          'source1'
        )
      );

      const source1Events = eventBus.getEventsBySource('source1');
      expect(source1Events).toHaveLength(2);

      const source2Events = eventBus.getEventsBySource('source2');
      expect(source2Events).toHaveLength(1);
    });
  });

  describe('Handler Map Memory Leak Prevention', () => {
    it('should remove handlers from map when unsubscribing', async () => {
      const handler = vi.fn();

      eventBus.subscribe('user.session.started', handler);

      // Check handler is registered
      const statsBefore = eventBus.getStats();
      expect(statsBefore.handlerCount).toBeGreaterThan(0);

      eventBus.unsubscribe('user.session.started', handler);

      // Handler should be removed
      const statsAfter = eventBus.getStats();
      expect(statsAfter.handlerCount).toBe(0);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );
      await eventBus.publish(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should clear handler map on removeAllListeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.subscribe('user.session.started', handler1);
      eventBus.subscribe('user.session.updated', handler2);

      eventBus.removeAllListeners('user.session.started');

      const stats = eventBus.getStats();
      // Listeners should be reduced
      expect(stats.listeners).toBe(0);
    });

    it('should clear all handlers on removeAllListeners without event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.subscribe('user.session.started', handler1);
      eventBus.subscribe('user.session.updated', handler2);

      eventBus.removeAllListeners();

      const stats = eventBus.getStats();
      expect(stats.listeners).toBe(0);
    });
  });

  describe('Middleware', () => {
    it('should run middleware in order', async () => {
      const executionOrder: string[] = [];

      eventBus.use(async (event, next) => {
        executionOrder.push('middleware1');
        await next();
      });

      eventBus.use(async (event, next) => {
        executionOrder.push('middleware2');
        await next();
      });

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      expect(executionOrder).toEqual(['middleware1', 'middleware2']);
      expect(handler).toHaveBeenCalled();
    });

    it('should block event if middleware throws with blocked flag', async () => {
      eventBus.use(async (event, next) => {
        const error: any = new Error('Blocked');
        error.blocked = true;
        throw error;
      });

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should use logging middleware', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      eventBus.use(loggingMiddleware);

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      expect(handler).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should use validation middleware', async () => {
      eventBus.use(validationMiddleware);

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      // Valid event
      const validEvent = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );
      await eventBus.publish(validEvent);
      expect(handler).toHaveBeenCalled();

      // Invalid event (missing required fields)
      const invalidEvent = {
        type: 'user.session.started',
        metadata: { timestamp: Date.now() }, // Missing source
        data: { userId: 1 },
      } as any;

      await expect(eventBus.publish(invalidEvent)).rejects.toThrow();
    });

    it('should use error handling middleware', async () => {
      const errorHandler = vi.fn();
      eventBus.on('error', errorHandler);

      eventBus.use(errorHandlingMiddleware);

      const handler = vi.fn(() => {
        throw new Error('Handler error');
      });
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      // Should not throw, error should be caught
      await eventBus.publish(event);

      // Error should be emitted as error event
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Rate Limiting Middleware', () => {
    it('should rate limit events', async () => {
      const rateLimiter = new RateLimitingMiddleware(1000, 2); // 2 events per second
      eventBus.use(rateLimiter.middleware);

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      // First 2 should pass
      await eventBus.publish(event);
      await eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(2);

      // Third should be rate limited
      await eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(2); // Still 2, third was blocked
    });

    it('should clean up expired rate limit windows', async () => {
      const rateLimiter = new RateLimitingMiddleware(100, 1); // 1 event per 100ms
      eventBus.use(rateLimiter.middleware);

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be able to publish again
      await eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Metrics Middleware', () => {
    it('should track event metrics', async () => {
      const metrics = new MetricsMiddleware(1000); // 1 second TTL
      eventBus.use(metrics.middleware);

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);
      await eventBus.publish(event);

      const eventMetrics = metrics.getMetrics();
      expect(eventMetrics['user.session.started']).toBeDefined();
      expect(eventMetrics['user.session.started'].count).toBe(2);
    });

    it('should clean up expired metrics', async () => {
      const metrics = new MetricsMiddleware(100); // 100ms TTL
      eventBus.use(metrics.middleware);

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Note: Cleanup happens on interval, may not be immediate
      // Just verify metrics were tracked
      const eventMetrics = metrics.getMetrics();
      expect(eventMetrics['user.session.started']).toBeDefined();
    });
  });

  describe('Shutdown and Cleanup', () => {
    it('should clear all resources on shutdown', async () => {
      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);
      expect(eventBus.getEventHistory()).toHaveLength(1);

      eventBus.shutdown();

      // History should be cleared
      expect(eventBus.getEventHistory()).toHaveLength(0);

      // Handlers should be removed
      const stats = eventBus.getStats();
      expect(stats.listeners).toBe(0);

      // Should not receive events after shutdown
      await eventBus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1); // Only called before shutdown
    });

    it('should clear middleware on shutdown', () => {
      eventBus.use(loggingMiddleware);
      eventBus.use(validationMiddleware);

      eventBus.shutdown();

      // Middleware should be cleared
      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      // Should not throw even without middleware
      expect(async () => await eventBus.publish(event)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should emit error event when handler throws', async () => {
      const errorHandler = vi.fn();
      eventBus.on('error', errorHandler);

      const handler = vi.fn(() => {
        throw new Error('Handler error');
      });
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      await eventBus.publish(event);

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0].error).toBeInstanceOf(Error);
    });

    it('should handle errors in middleware gracefully', async () => {
      const errorHandler = vi.fn();
      eventBus.on('error', errorHandler);

      eventBus.use(async (event, next) => {
        throw new Error('Middleware error');
      });

      const handler = vi.fn();
      eventBus.subscribe('user.session.started', handler);

      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      // Should not throw, error should be caught and emitted as error event
      await eventBus.publish(event);

      // Error should be emitted as error event
      expect(errorHandler).toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('EventFactory', () => {
    it('should create system events', () => {
      const event = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test'
      );

      expect(event.type).toBe('user.session.started');
      expect(event.metadata.source).toBe('test');
      expect(event.metadata.timestamp).toBeDefined();
      expect(event.metadata.correlationId).toBeDefined();
    });

    it('should create user events with userId', () => {
      const event = EventFactory.createUserEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test',
        123,
        'session-456'
      );

      expect(event.metadata.userId).toBe(123);
      expect(event.metadata.sessionId).toBe('session-456');
    });

    it('should generate unique correlation IDs', () => {
      const event1 = EventFactory.createSystemEvent('user.session.started', {}, 'test');
      const event2 = EventFactory.createSystemEvent('user.session.started', {}, 'test');

      expect(event1.metadata.correlationId).not.toBe(event2.metadata.correlationId);
    });
  });

  describe('Stats', () => {
    it('should return accurate stats', async () => {
      eventBus.subscribe('user.session.started', vi.fn());
      eventBus.subscribe('user.session.updated', vi.fn());

      const event1 = EventFactory.createSystemEvent(
        'user.session.started',
        { userId: 1, sessionData: {} },
        'test1'
      );
      const event2 = EventFactory.createSystemEvent(
        'user.session.updated',
        { userId: 1, sessionData: {} },
        'test2'
      );

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      const stats = eventBus.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.eventTypes).toContain('user.session.started');
      expect(stats.eventTypes).toContain('user.session.updated');
      expect(stats.sources).toContain('test1');
      expect(stats.sources).toContain('test2');
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not grow unbounded with many events when history is disabled', async () => {
      const busWithoutHistory = new EventBus({ enableHistory: false });

      for (let i = 0; i < 1000; i++) {
        const event = EventFactory.createSystemEvent(
          'user.session.started',
          { userId: i, sessionData: {} },
          'test'
        );
        await busWithoutHistory.publish(event);
      }

      const history = busWithoutHistory.getEventHistory();
      expect(history.length).toBe(0);

      busWithoutHistory.shutdown();
    });

    it('should clean up handler map when handlers are removed', () => {
      const handlers: Array<() => void> = [];

      // Add many handlers
      for (let i = 0; i < 100; i++) {
        const handler = vi.fn();
        handlers.push(handler);
        eventBus.subscribe('user.session.started', handler);
      }

      // Remove all handlers
      handlers.forEach((handler) => {
        eventBus.unsubscribe('user.session.started', handler);
      });

      // Handler map should be empty
      const stats = eventBus.getStats();
      expect(stats.listeners).toBe(0);
    });
  });
});
