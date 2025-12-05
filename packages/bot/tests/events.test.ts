/**
 * Event Bus Tests
 * ==============
 * Tests for the event-driven architecture functionality
 */

import { EventBus, EventFactory } from '../../src/events/EventBus';
import { loggingMiddleware, MetricsMiddleware, RateLimitingMiddleware } from '../../src/events/EventMiddleware';
import { EventHandlerRegistry } from '../../src/events/EventHandlers';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  describe('Event Publishing and Subscription', () => {
    it('should publish and receive events', async () => {
      const handler = jest.fn();
      eventBus.subscribe('test.event', handler);

      const event = EventFactory.create('test.event', { message: 'Hello' }, 'test-source');
      await eventBus.publish(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle multiple subscribers', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      eventBus.subscribe('test.event', handler1);
      eventBus.subscribe('test.event', handler2);

      const event = EventFactory.create('test.event', { message: 'Hello' }, 'test-source');
      await eventBus.publish(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should unsubscribe handlers', async () => {
      const handler = jest.fn();
      eventBus.subscribe('test.event', handler);
      eventBus.unsubscribe('test.event', handler);

      const event = EventFactory.create('test.event', { message: 'Hello' }, 'test-source');
      await eventBus.publish(event);

      // Give a moment for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Event History', () => {
    it('should maintain event history', async () => {
      const event1 = EventFactory.create('test.event1', { data: 1 }, 'source1');
      const event2 = EventFactory.create('test.event2', { data: 2 }, 'source2');

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      const history = eventBus.getEventHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(event1);
      expect(history[1]).toEqual(event2);
    });

    it('should filter events by type', async () => {
      const event1 = EventFactory.create('test.event', { data: 1 }, 'source1');
      const event2 = EventFactory.create('other.event', { data: 2 }, 'source2');

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      const testEvents = eventBus.getEventsByType('test.event');
      expect(testEvents).toHaveLength(1);
      expect(testEvents[0]).toEqual(event1);
    });

    it('should filter events by source', async () => {
      const event1 = EventFactory.create('test.event', { data: 1 }, 'source1');
      const event2 = EventFactory.create('test.event', { data: 2 }, 'source2');

      await eventBus.publish(event1);
      await eventBus.publish(event2);

      const source1Events = eventBus.getEventsBySource('source1');
      expect(source1Events).toHaveLength(1);
      expect(source1Events[0]).toEqual(event1);
    });
  });

  describe('Event Statistics', () => {
    it('should provide event statistics', async () => {
      const event1 = EventFactory.create('test.event', { data: 1 }, 'source1');
      const event2 = EventFactory.create('test.event', { data: 2 }, 'source2');
      const event3 = EventFactory.create('other.event', { data: 3 }, 'source1');

      await eventBus.publish(event1);
      await eventBus.publish(event2);
      await eventBus.publish(event3);

      const stats = eventBus.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.eventTypes).toContain('test.event');
      expect(stats.eventTypes).toContain('other.event');
      expect(stats.sources).toContain('source1');
      expect(stats.sources).toContain('source2');
    });
  });

  describe('Middleware', () => {
    it('should run middleware pipeline', async () => {
      const middleware1 = jest.fn().mockImplementation(async (event, next) => {
        event.data.processedBy1 = true;
        await next();
      });
      
      const middleware2 = jest.fn().mockImplementation(async (event, next) => {
        event.data.processedBy2 = true;
        await next();
      });

      eventBus.use(middleware1);
      eventBus.use(middleware2);

      const handler = jest.fn();
      eventBus.subscribe('test.event', handler);

      const event = EventFactory.create('test.event', { original: true }, 'test-source');
      await eventBus.publish(event);

      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).toHaveBeenCalled();
      expect(event.data.processedBy1).toBe(true);
      expect(event.data.processedBy2).toBe(true);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle middleware errors', async () => {
      const errorMiddleware = jest.fn().mockImplementation(async (event, next) => {
        throw new Error('Middleware error');
      });

      eventBus.use(errorMiddleware);

      const handler = jest.fn();
      eventBus.subscribe('test.event', handler);

      const event = EventFactory.create('test.event', { data: 'test' }, 'test-source');
      
      await expect(eventBus.publish(event)).rejects.toThrow('Middleware error');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle handler errors', async () => {
      const errorHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });

      eventBus.subscribe('test.event', errorHandler);

      const event = EventFactory.create('test.event', { data: 'test' }, 'test-source');
      
      // Should not throw, but should emit error event
      const errorSpy = jest.fn();
      eventBus.on('error', errorSpy);
      
      await eventBus.publish(event);
      
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event,
          error: expect.any(Error)
        })
      );
    });
  });
});

describe('EventFactory', () => {
  it('should create events with proper structure', () => {
    const event = EventFactory.create('test.event', { message: 'Hello' }, 'test-source');
    
    expect(event.type).toBe('test.event');
    expect(event.data).toEqual({ message: 'Hello' });
    expect(event.metadata.source).toBe('test-source');
    expect(event.metadata.timestamp).toBeDefined();
    expect(event.metadata.correlationId).toBeDefined();
  });

  it('should create user events with user context', () => {
    const event = EventFactory.createUserEvent('test.event', { data: 'test' }, 'test-source', 123, 'session-456');
    
    expect(event.metadata.userId).toBe(123);
    expect(event.metadata.sessionId).toBe('session-456');
  });

  it('should create system events', () => {
    const event = EventFactory.createSystemEvent('system.startup', { component: 'test' }, 'system');
    
    expect(event.type).toBe('system.startup');
    expect(event.metadata.source).toBe('system');
    expect(event.metadata.userId).toBeUndefined();
  });
});

describe('Middleware', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('MetricsMiddleware', () => {
    it('should collect metrics', async () => {
      const metricsMiddleware = new MetricsMiddleware();
      eventBus.use(metricsMiddleware.middleware);

      const handler = jest.fn();
      eventBus.subscribe('test.event', handler);

      const event = EventFactory.create('test.event', { data: 'test' }, 'test-source');
      await eventBus.publish(event);

      const metrics = metricsMiddleware.getMetrics();
      expect(metrics['test.event']).toBeDefined();
      expect(metrics['test.event'].count).toBe(1);
    });
  });

  describe('RateLimitingMiddleware', () => {
    it('should rate limit events', async () => {
      const rateLimitMiddleware = new RateLimitingMiddleware(1000, 1); // 1 event per second
      eventBus.use(rateLimitMiddleware.middleware);

      const handler = jest.fn();
      eventBus.subscribe('test.event', handler);

      const event = EventFactory.create('test.event', { data: 'test' }, 'test-source');
      
      // First event should pass
      await eventBus.publish(event);
      
      // Second event should be rate limited
      await eventBus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('EventHandlerRegistry', () => {
  let eventBus: EventBus;
  let registry: EventHandlerRegistry;

  beforeEach(() => {
    eventBus = new EventBus();
    registry = new EventHandlerRegistry(eventBus);
  });

  it('should register all event handlers', () => {
    registry.registerAll();
    
    // Check that handlers are registered by verifying event types
    const stats = eventBus.getStats();
    // The listenerCount method counts all listeners, not just for specific events
    expect(eventBus.listenerCount('user.session.started')).toBeGreaterThan(0);
  });
});
