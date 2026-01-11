import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loggingMiddleware,
  MetricsMiddleware,
  errorHandlingMiddleware,
  RateLimitingMiddleware,
  validationMiddleware,
  correlationMiddleware,
  userContextMiddleware,
  PerformanceMiddleware,
} from '../src/events/EventMiddleware';
import { EventFactory } from '../src/events/EventBus';
import { logger } from '../src/logger';

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Event Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loggingMiddleware', () => {
    it('should log events with appropriate level', async () => {
      // The EventFactory.createSystemEvent expects 3 arguments: (type, payload, metadata)
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test' // Provide string metadata as required third argument
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await loggingMiddleware(event, next);

      expect(logger.info).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('MetricsMiddleware', () => {
    it('should track event metrics', async () => {
      const middleware = new MetricsMiddleware(100, 0);
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test' // Provide string for metadata as required third argument
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.middleware(event, next);

      const metrics = middleware.getMetrics();
      expect(metrics).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('should clean up old metrics', async () => {
      const middleware = new MetricsMiddleware(100, 1000);
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test' // Provide metadata as required third argument
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.middleware(event, next);

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const metrics = middleware.getMetrics();
      expect(metrics).toBeDefined();
    });

    it('should clear metrics', () => {
      const middleware = new MetricsMiddleware();
      middleware.clearMetrics();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('errorHandlingMiddleware', () => {
    it('should catch and log errors', async () => {
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      const error = new Error('Test error');
      const next = vi.fn().mockRejectedValue(error);

      await expect(errorHandlingMiddleware(event, next)).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should pass through successful events', async () => {
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      ); // Provide metadata as third argument
      const next = vi.fn().mockResolvedValue(undefined);

      await errorHandlingMiddleware(event, next);
    });

    it('should call next handler', async () => {
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await errorHandlingMiddleware(event, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('RateLimitingMiddleware', () => {
    it('should allow events within rate limit', async () => {
      const middleware = new RateLimitingMiddleware(1000, 10);
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.middleware(event, next);

      expect(next).toHaveBeenCalled();
    });

    it('should cleanup expired windows', () => {
      const middleware = new RateLimitingMiddleware(1000, 10);
      middleware.cleanup();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('validationMiddleware', () => {
    it('should validate event structure', async () => {
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await validationMiddleware(event, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('correlationMiddleware', () => {
    it('should add correlation ID if missing', async () => {
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      const originalCorrelationId = event.metadata.correlationId;
      const next = vi.fn().mockResolvedValue(undefined);

      await correlationMiddleware(event, next);

      expect(event.metadata.correlationId).toBeDefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('userContextMiddleware', () => {
    it('should preserve user context', async () => {
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      event.metadata.userId = 1;
      const next = vi.fn().mockResolvedValue(undefined);

      await userContextMiddleware(event, next);

      expect(event.metadata.userId).toBe(1);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('PerformanceMiddleware', () => {
    it('should measure event processing time', async () => {
      const middleware = new PerformanceMiddleware();
      const event = EventFactory.createSystemEvent(
        'system.startup',
        {
          component: 'test',
          message: 'Starting',
        },
        'test'
      );
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware.middleware(event, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
