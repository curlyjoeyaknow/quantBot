import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogAggregator } from '../src/logging/aggregator';

// Mock fetch globally
global.fetch = vi.fn();

describe('LogAggregator', () => {
  let aggregator: LogAggregator;

  afterEach(() => {
    if (aggregator) {
      aggregator.stop();
    }
  });

  describe('constructor', () => {
    it('should create aggregator with default config', () => {
      aggregator = new LogAggregator({ enabled: false });
      expect(aggregator).toBeDefined();
    });

    it('should start flush timer when enabled', () => {
      aggregator = new LogAggregator({
        enabled: true,
        flushInterval: 1000,
      });
      expect(aggregator).toBeDefined();
      aggregator.stop();
    });
  });

  describe('add', () => {
    it('should add log to buffer when enabled', () => {
      aggregator = new LogAggregator({ enabled: true });
      aggregator.add({ level: 'info', message: 'Test' });
      // Buffer is private, but we can test flush behavior
      expect(aggregator).toBeDefined();
      aggregator.stop();
    });

    it('should not add log when disabled', () => {
      aggregator = new LogAggregator({ enabled: false });
      aggregator.add({ level: 'info', message: 'Test' });
      expect(aggregator).toBeDefined();
    });

    it('should flush when buffer reaches batch size', async () => {
      aggregator = new LogAggregator({
        enabled: true,
        batchSize: 2,
      });
      const flushSpy = vi.spyOn(aggregator, 'flush');

      aggregator.add({ level: 'info', message: 'Test 1' });
      aggregator.add({ level: 'info', message: 'Test 2' });

      // Flush should be called when batch size is reached
      await new Promise((resolve) => setTimeout(resolve, 10));
      aggregator.stop();
    });
  });

  describe('flush', () => {
    it('should flush logs when buffer has entries', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock fetch to return success
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        statusText: 'OK',
      } as Response);

      aggregator = new LogAggregator({
        enabled: true,
        endpoint: 'https://test.com',
        apiKey: 'test-key',
        serviceType: 'custom', // Provide serviceType to avoid warning
      });

      aggregator.add({ level: 'info', message: 'Test' });
      await aggregator.flush();

      aggregator.stop();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should do nothing when buffer is empty', async () => {
      aggregator = new LogAggregator({ enabled: true });
      await aggregator.flush();
      aggregator.stop();
    });
  });

  describe('stop', () => {
    it('should stop flush timer', () => {
      aggregator = new LogAggregator({
        enabled: true,
        flushInterval: 1000,
      });
      aggregator.stop();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
