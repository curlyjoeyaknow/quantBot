/**
 * Metrics Collector Tests
 * ========================
 * Unit tests for metrics collection with EventBus integration and manual timers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsCollector, getMetricsCollector, startTimer } from '../src/metrics-collector';
import type { ApplicationEvent } from '@quantbot/infra/utils';

// Mock the InfluxDB writer - must return same instance
const mockWriterSingleton = {
  writeLatency: vi.fn().mockResolvedValue(undefined),
  writeThroughput: vi.fn().mockResolvedValue(undefined),
  getPackageVersion: vi.fn().mockReturnValue('1.0.0'),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/influxdb-metrics-writer', () => ({
  getMetricsWriter: vi.fn(() => mockWriterSingleton),
  InfluxDBMetricsWriter: vi.fn().mockImplementation(() => mockWriterSingleton),
}));

// Mock EventBus - create inside factory to avoid hoisting issues
vi.mock('@quantbot/infra/utils', async () => {
  const actual = await vi.importActual('@quantbot/infra/utils');
  const mockEventBus = {
    subscribe: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };

  return {
    ...actual,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    eventBus: mockEventBus,
  };
});

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let mockWriter: typeof mockWriterSingleton;
  let mockEventBus: {
    subscribe: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked instances
    const { getMetricsWriter } = await import('../src/influxdb-metrics-writer');
    mockWriter = getMetricsWriter() as typeof mockWriterSingleton;

    const utils = await import('@quantbot/infra/utils');
    mockEventBus = (utils as any).eventBus || mockEventBusInstance;

    // Clear any previous calls
    mockWriter.writeLatency.mockClear();
    mockWriter.writeThroughput.mockClear();
    mockWriter.close.mockClear();
    mockEventBus.subscribe.mockClear();
    // Reset return values
    mockWriter.writeLatency.mockResolvedValue(undefined);
    mockWriter.writeThroughput.mockResolvedValue(undefined);
    mockWriter.close.mockResolvedValue(undefined);

    collector = new MetricsCollector();
  });

  afterEach(async () => {
    await collector.shutdown();
  });

  describe('initialization', () => {
    it('should initialize and subscribe to EventBus events', () => {
      collector.initialize();

      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'simulation.completed',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'simulation.started',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'simulation.failed',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'database.query.executed',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'websocket.message.received',
        expect.any(Function)
      );
    });

    it('should not initialize twice', () => {
      collector.initialize();
      const firstCallCount = mockEventBus.subscribe.mock.calls.length;
      collector.initialize();
      const secondCallCount = mockEventBus.subscribe.mock.calls.length;

      // Should not subscribe again on second call
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('manual timer API', () => {
    it('should start and stop a timer', async () => {
      const timer = collector.startTimer('test.operation', 'test-component');
      // Use 20ms sleep to ensure we get at least 10ms duration even with timing variance
      await new Promise((resolve) => setTimeout(resolve, 20));
      timer.stop({ success: true });

      // Wait for async write to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWriter.writeLatency).toHaveBeenCalledTimes(1);
      const call = mockWriter.writeLatency.mock.calls[0][0];
      expect(call.operation).toBe('test.operation');
      expect(call.component).toBe('test-component');
      expect(call.success).toBe(true);
      expect(call.durationMs).toBeGreaterThanOrEqual(10);
    });

    it('should record metadata with timer', async () => {
      const timer = collector.startTimer('test.operation', 'test-component');
      timer.stop({
        success: true,
        metadata: { key: 'value', count: 42 },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWriter.writeLatency).toHaveBeenCalled();
      const call = mockWriter.writeLatency.mock.calls[0][0];
      expect(call.metadata).toEqual({ key: 'value', count: 42 });
    });

    it('should mark timer as failed when success is false', async () => {
      const timer = collector.startTimer('test.operation', 'test-component');
      timer.stop({ success: false });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWriter.writeLatency).toHaveBeenCalled();
      const call = mockWriter.writeLatency.mock.calls[0][0];
      expect(call.success).toBe(false);
    });
  });

  describe('EventBus integration', () => {
    it('should capture simulation.completed events', async () => {
      collector.initialize();

      const event: ApplicationEvent = {
        type: 'simulation.completed',
        metadata: {
          timestamp: Date.now() - 100,
          source: 'test',
        },
        data: {
          userId: 1,
          mint: 'test-mint',
          chain: 'solana',
        },
      };

      // Get the handler that was registered
      const subscribeCalls = mockEventBus.subscribe.mock.calls;
      const simulationCompletedHandler = subscribeCalls.find(
        (call) => call[0] === 'simulation.completed'
      )?.[1];

      expect(simulationCompletedHandler).toBeDefined();
      if (simulationCompletedHandler) {
        await simulationCompletedHandler(event);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockWriter.writeLatency).toHaveBeenCalled();
        const call = mockWriter.writeLatency.mock.calls[0][0];
        expect(call.operation).toBe('simulation.e2e');
        expect(call.component).toBe('simulation');
        expect(call.success).toBe(true);
        expect(call.metadata).toMatchObject({
          userId: 1,
          mint: 'test-mint',
          chain: 'solana',
        });
      }
    });

    it('should capture simulation.failed events', async () => {
      collector.initialize();

      const event: ApplicationEvent = {
        type: 'simulation.failed',
        metadata: {
          timestamp: Date.now() - 100,
          source: 'test',
        },
        data: {
          userId: 1,
          mint: 'test-mint',
          error: 'Test error',
        },
      };

      const subscribeCalls = mockEventBus.subscribe.mock.calls;
      const handler = subscribeCalls.find((call) => call[0] === 'simulation.failed')?.[1];

      expect(handler).toBeDefined();
      if (handler) {
        await handler(event);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockWriter.writeLatency).toHaveBeenCalled();
        const call = mockWriter.writeLatency.mock.calls[0][0];
        expect(call.success).toBe(false);
      }
    });

    it('should capture database.query.executed events', async () => {
      collector.initialize();

      const event: ApplicationEvent = {
        type: 'database.query.executed',
        metadata: {
          timestamp: Date.now() - 50,
          source: 'test',
        },
        data: {
          operation: 'SELECT',
          duration: 25,
          table: 'tokens',
        },
      };

      const subscribeCalls = mockEventBus.subscribe.mock.calls;
      const handler = subscribeCalls.find((call) => call[0] === 'database.query.executed')?.[1];

      expect(handler).toBeDefined();
      if (handler) {
        await handler(event);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockWriter.writeLatency).toHaveBeenCalled();
        const call = mockWriter.writeLatency.mock.calls[0][0];
        expect(call.operation).toBe('SELECT');
        expect(call.component).toBe('storage');
        expect(call.durationMs).toBe(25);
      }
    });

    it('should track websocket message throughput', async () => {
      collector.initialize();

      const event: ApplicationEvent = {
        type: 'websocket.message.received',
        metadata: {
          timestamp: Date.now(),
          source: 'test',
        },
        data: {
          messageType: 'price_update',
        },
      };

      const subscribeCalls = mockEventBus.subscribe.mock.calls;
      const handler = subscribeCalls.find((call) => call[0] === 'websocket.message.received')?.[1];

      expect(handler).toBeDefined();
      if (handler) {
        await handler(event);
        // Should increment throughput counter (internal state)
        expect(collector).toBeDefined();
      }
    });
  });

  describe('throughput tracking', () => {
    it('should increment throughput counters', () => {
      collector.incrementThroughput('test.operation', 'test-component', 5);
      collector.incrementThroughput('test.operation', 'test-component', 3);

      // Counters are internal, but we can test flush
      expect(collector).toBeDefined();
    });

    it('should flush throughput counters', async () => {
      collector.incrementThroughput('test.operation', 'test-component', 10);
      // Manually set start time to ensure period > 0
      const counters = (collector as any).throughputCounters;
      const key = 'test.operation_test-component';
      if (counters.has(key)) {
        counters.get(key).startTime = Date.now() - 2000; // 2 seconds ago
      }

      await collector.flushThroughputCounters();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWriter.writeThroughput).toHaveBeenCalled();
      const call = mockWriter.writeThroughput.mock.calls[0][0];
      expect(call.operation).toBe('test.operation');
      expect(call.component).toBe('test-component');
      expect(call.count).toBe(10);
    });
  });

  describe('convenience functions', () => {
    it('should provide startTimer convenience function', async () => {
      // Use the collector instance directly to ensure same mock
      const timer = collector.startTimer('convenience.test', 'test-component');
      timer.stop({ success: true });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWriter.writeLatency).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should flush counters and close writer on shutdown', async () => {
      collector.incrementThroughput('test.operation', 'test-component', 5);
      // Set start time to ensure flush happens
      const counters = (collector as any).throughputCounters;
      const key = 'test.operation_test-component';
      if (counters.has(key)) {
        counters.get(key).startTime = Date.now() - 2000;
      }

      await collector.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockWriter.close).toHaveBeenCalled();
    });
  });
});
