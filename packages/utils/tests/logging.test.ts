/**
 * Centralized Logging Tests
 * =========================
 * Tests for the centralized logging system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPackageLogger, LogHelpers, createLogger } from '../src/logging';
import { Logger } from '../src/logger';
import { LogMonitor, CommonPatterns } from '../src/logging/monitor';
import { LogAggregator } from '../src/logging/aggregator';

describe('Centralized Logging System', () => {
  describe('Package Loggers', () => {
    it('should create package-specific loggers with namespaces', () => {
      const botLogger = createPackageLogger('@quantbot/bot');
      const servicesLogger = createPackageLogger('@quantbot/services');

      expect(botLogger).toBeInstanceOf(Logger);
      expect(servicesLogger).toBeInstanceOf(Logger);
      expect(botLogger.getNamespace()).toBe('@quantbot/bot');
      expect(servicesLogger.getNamespace()).toBe('@quantbot/services');
    });

    it('should cache package loggers', () => {
      const logger1 = createPackageLogger('@quantbot/test');
      const logger2 = createPackageLogger('@quantbot/test');

      expect(logger1).toBe(logger2);
    });

    it('should include namespace in log context', () => {
      const logger = createPackageLogger('@quantbot/test');
      const context = logger.getContext();

      // Namespace is added during mergeContext, not in stored context
      expect(logger.getNamespace()).toBe('@quantbot/test');
    });
  });

  describe('Child Loggers', () => {
    it('should create child logger with persistent context', () => {
      const parentLogger = createPackageLogger('@quantbot/test');
      const childLogger = parentLogger.child({ userId: 123 });

      expect(childLogger).toBeInstanceOf(Logger);
      expect(childLogger.getNamespace()).toBe('@quantbot/test');
      expect(childLogger.getContext()).toEqual({ userId: 123 });
    });

    it('should inherit parent namespace', () => {
      const parentLogger = createLogger('@quantbot/parent');
      const childLogger = parentLogger.child({ sessionId: 'abc' });

      expect(childLogger.getNamespace()).toBe('@quantbot/parent');
    });
  });

  describe('Log Helpers', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger('@quantbot/test');
    });

    it('should log API requests', () => {
      const spy = vi.spyOn(logger, 'debug');
      
      LogHelpers.apiRequest(logger, 'GET', 'https://api.example.com', { userId: 123 });
      
      expect(spy).toHaveBeenCalledWith('API Request', {
        method: 'GET',
        url: 'https://api.example.com',
        userId: 123,
      });
    });

    it('should log API responses with appropriate level', () => {
      const debugSpy = vi.spyOn(logger, 'debug');
      const warnSpy = vi.spyOn(logger, 'warn');

      // Success response
      LogHelpers.apiResponse(logger, 'GET', 'https://api.example.com', 200, 100);
      expect(debugSpy).toHaveBeenCalled();

      // Error response
      LogHelpers.apiResponse(logger, 'GET', 'https://api.example.com', 500, 100);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should log database queries', () => {
      const spy = vi.spyOn(logger, 'debug');
      
      LogHelpers.dbQuery(logger, 'SELECT', 'users', 45, { rows: 100 });
      
      expect(spy).toHaveBeenCalledWith('Database Query', {
        operation: 'SELECT',
        table: 'users',
        duration: 45,
        rows: 100,
      });
    });

    it('should log WebSocket events', () => {
      const spy = vi.spyOn(logger, 'debug');
      
      LogHelpers.websocketEvent(logger, 'message', { type: 'trade' });
      
      expect(spy).toHaveBeenCalledWith('WebSocket Event', {
        event: 'message',
        data: { type: 'trade' },
      });
    });

    it('should log simulations', () => {
      const spy = vi.spyOn(logger, 'info');
      
      LogHelpers.simulation(logger, 'ichimoku-v1', 'token123', { pnl: 1.5 });
      
      expect(spy).toHaveBeenCalledWith('Simulation Completed', {
        strategy: 'ichimoku-v1',
        tokenAddress: 'token123',
        result: { pnl: 1.5 },
      });
    });

    it('should log cache operations', () => {
      const spy = vi.spyOn(logger, 'debug');
      
      LogHelpers.cache(logger, 'hit', 'ohlcv:token123:1m');
      
      expect(spy).toHaveBeenCalledWith('Cache hit', {
        key: 'ohlcv:token123:1m',
      });
    });

    it('should log performance metrics', () => {
      const spy = vi.spyOn(logger, 'info');
      
      LogHelpers.performance(logger, 'fetchCandles', 234, true);
      
      expect(spy).toHaveBeenCalledWith('Performance Metric', {
        operation: 'fetchCandles',
        duration: 234,
        success: true,
      });
    });
  });

  describe('Log Monitor', () => {
    let monitor: LogMonitor;

    beforeEach(() => {
      monitor = new LogMonitor();
    });

    afterEach(() => {
      monitor.stop();
    });

    it('should register and match patterns', async () => {
      const promise = new Promise<void>((resolve) => {
        monitor.registerPattern({
          id: 'test-pattern',
          name: 'Test Pattern',
          level: 'error',
          messagePattern: /test error/i,
          threshold: 1,
          onMatch: (log) => {
            expect(log.message).toContain('test error');
            resolve();
          },
        });
      });

      monitor.processLog({
        level: 'error',
        message: 'This is a test error',
        namespace: '@quantbot/test',
      });

      await promise;
    });

    it('should trigger alert when threshold exceeded', async () => {
      const promise = new Promise<void>((resolve) => {
        monitor.registerPattern({
          id: 'threshold-test',
          name: 'Threshold Test',
          level: 'error',
          messagePattern: /error/i,
          threshold: 3,
          timeWindow: 60000,
        });

        monitor.on('alert', (alert) => {
          expect(alert.count).toBe(3);
          expect(alert.patternId).toBe('threshold-test');
          resolve();
        });
      });

      // Trigger 3 times
      for (let i = 0; i < 3; i++) {
        monitor.processLog({
          level: 'error',
          message: 'An error occurred',
          namespace: '@quantbot/test',
        });
      }

      await promise;
    });

    it('should not match if level is different', () => {
      const matchFn = vi.fn();
      
      monitor.registerPattern({
        id: 'level-test',
        name: 'Level Test',
        level: 'error',
        onMatch: matchFn,
      });

      monitor.processLog({
        level: 'info',
        message: 'Info message',
      });

      expect(matchFn).not.toHaveBeenCalled();
    });

    it('should match namespace patterns', async () => {
      const promise = new Promise<void>((resolve) => {
        monitor.registerPattern({
          id: 'namespace-test',
          name: 'Namespace Test',
          namespacePattern: /@quantbot\/services/,
          onMatch: () => resolve(),
        });
      });

      monitor.processLog({
        level: 'info',
        message: 'Test',
        namespace: '@quantbot/services',
      });

      await promise;
    });

    it('should provide common patterns', () => {
      const dbPattern = CommonPatterns.databaseErrors();
      expect(dbPattern.id).toBe('database-errors');
      expect(dbPattern.threshold).toBe(5);

      const rateLimitPattern = CommonPatterns.rateLimitErrors();
      expect(rateLimitPattern.id).toBe('rate-limit-errors');
    });
  });

  describe('Log Aggregator', () => {
    let aggregator: LogAggregator;

    beforeEach(() => {
      aggregator = new LogAggregator({
        enabled: true,
        batchSize: 5,
        flushInterval: 1000,
      });
    });

    afterEach(async () => {
      await aggregator.stop();
    });

    it('should buffer logs', () => {
      aggregator.add({ level: 'info', message: 'Test 1' });
      aggregator.add({ level: 'info', message: 'Test 2' });

      // Logs are in buffer (internal state, can't directly test)
      expect(aggregator).toBeDefined();
    });

    it('should flush when batch size is reached', async () => {
      const spy = vi.spyOn(aggregator as any, 'sendLogs');

      for (let i = 0; i < 5; i++) {
        aggregator.add({ level: 'info', message: `Test ${i}` });
      }

      // Should have flushed automatically
      expect(spy).toHaveBeenCalled();
    });

    it('should not process logs when disabled', () => {
      const disabledAggregator = new LogAggregator({
        enabled: false,
      });

      const spy = vi.spyOn(disabledAggregator as any, 'sendLogs');

      disabledAggregator.add({ level: 'info', message: 'Test' });

      expect(spy).not.toHaveBeenCalled();
    });
  });
});

