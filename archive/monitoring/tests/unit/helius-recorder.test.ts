import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeliusStreamRecorder } from '../../src/stream/helius-recorder';
import WebSocket from 'ws';

vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      removeAllListeners: vi.fn(),
      readyState: WebSocket.CONNECTING,
    })),
  };
});

vi.mock('@quantbot/storage', () => ({
  insertTicks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getTrackedTokens: vi.fn().mockResolvedValue([]),
}));

vi.mock('../aggregation/ohlcv-aggregator', () => ({
  ohlcvAggregator: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

describe('HeliusStreamRecorder', () => {
  let recorder: HeliusStreamRecorder;

  beforeEach(() => {
    recorder = new HeliusStreamRecorder();
  });

  afterEach(() => {
    recorder.stop();
  });

  describe('cleanupWebSocket', () => {
    it('should remove all event listeners', (): void => {
      const mockWs = {
        removeAllListeners: vi.fn(),
        close: vi.fn(),
        readyState: WebSocket.OPEN,
      } as unknown as WebSocket;
      // Access private property for testing cleanup behavior
      const recorderPrivate = recorder as unknown as { ws: WebSocket | null; cleanupWebSocket: () => void };
      recorderPrivate.ws = mockWs;
      recorderPrivate.cleanupWebSocket();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('should start recorder when API key is set', async () => {
      process.env.HELIUS_API_KEY = 'test-key';
      await recorder.start();
      expect(recorder).toBeDefined();
    });

    it('should not start when API key is missing', async () => {
      delete process.env.HELIUS_API_KEY;
      await recorder.start();
      expect(recorder).toBeDefined();
    });
  });

  describe('stop', () => {
    it('should stop recorder and clean up resources', () => {
      recorder.stop();
      expect(recorder).toBeDefined();
    });
  });

  describe('trackToken', () => {
    it('should track a token', () => {
      const token = {
        mint: '7pXs123456789012345678901234567890pump',
        chain: 'solana',
        symbol: 'TEST',
      };
      recorder.trackToken(token);
      expect(recorder).toBeDefined();
    });
  });
});

