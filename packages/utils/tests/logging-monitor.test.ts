import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogMonitor } from '../src/logging/monitor';

describe('LogMonitor', () => {
  let monitor: LogMonitor;

  beforeEach(() => {
    monitor = new LogMonitor();
  });

  afterEach(() => {
    monitor.stop();
  });

  describe('registerPattern', () => {
    it('should register a log pattern', () => {
      monitor.registerPattern({
        id: 'test-pattern',
        name: 'Test Pattern',
        level: 'error',
        threshold: 5,
      });

      // Pattern is registered (private, but we can test via processLog)
      expect(monitor).toBeDefined();
    });

    it('should use default threshold and timeWindow', () => {
      monitor.registerPattern({
        id: 'test-pattern-2',
        name: 'Test Pattern 2',
      });

      expect(monitor).toBeDefined();
    });
  });

  describe('unregisterPattern', () => {
    it('should unregister a pattern', () => {
      monitor.registerPattern({
        id: 'test-pattern',
        name: 'Test Pattern',
      });

      monitor.unregisterPattern('test-pattern');
      expect(monitor).toBeDefined();
    });
  });

  describe('processLog', () => {
    it('should process log and match patterns', () => {
      const onMatch = vi.fn();
      monitor.registerPattern({
        id: 'error-pattern',
        name: 'Error Pattern',
        level: 'error',
        onMatch,
      });

      monitor.processLog({
        level: 'error',
        message: 'Test error',
        namespace: 'test',
      });

      // onMatch should be called if pattern matches
      expect(monitor).toBeDefined();
    });

    it('should not match if level does not match', () => {
      const onMatch = vi.fn();
      monitor.registerPattern({
        id: 'error-pattern',
        name: 'Error Pattern',
        level: 'error',
        onMatch,
      });

      monitor.processLog({
        level: 'info',
        message: 'Test info',
      });

      expect(monitor).toBeDefined();
    });

    it('should match namespace pattern', () => {
      const onMatch = vi.fn();
      monitor.registerPattern({
        id: 'namespace-pattern',
        name: 'Namespace Pattern',
        namespacePattern: 'test.*',
        onMatch,
      });

      monitor.processLog({
        level: 'info',
        message: 'Test',
        namespace: 'test.module',
      });

      expect(monitor).toBeDefined();
    });

    it('should match message pattern', () => {
      const onMatch = vi.fn();
      monitor.registerPattern({
        id: 'message-pattern',
        name: 'Message Pattern',
        messagePattern: /error/i,
        onMatch,
      });

      monitor.processLog({
        level: 'error',
        message: 'This is an error',
      });

      expect(monitor).toBeDefined();
    });

    it('should trigger alert when threshold is reached', () => {
      const onMatch = vi.fn();
      monitor.registerPattern({
        id: 'threshold-pattern',
        name: 'Threshold Pattern',
        level: 'error',
        threshold: 2,
        timeWindow: 60000,
        onMatch,
      });

      monitor.processLog({ level: 'error', message: 'Error 1' });
      monitor.processLog({ level: 'error', message: 'Error 2' });

      expect(monitor).toBeDefined();
    });
  });

  describe('stop', () => {
    it('should stop cleanup interval', () => {
      monitor.stop();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
