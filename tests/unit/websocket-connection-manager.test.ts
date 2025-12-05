import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketConnectionManager } from '../../src/websocket/WebSocketConnectionManager';
import { eventBus } from '../../src/events';
import WebSocket from 'ws';

// Mock WebSocket
vi.mock('ws', () => {
  const EventEmitter = require('events');
  
  class MockWebSocket extends EventEmitter {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    
    readyState = MockWebSocket.CONNECTING;
    url: string;
    send = vi.fn();
    close = vi.fn();
    
    constructor(url: string) {
      super();
      this.url = url;
      // Simulate connection after a tick
      setImmediate(() => {
        this.readyState = MockWebSocket.OPEN;
        this.emit('open');
      });
    }
  }
  
  return {
    default: MockWebSocket,
  };
});

// Mock event bus
vi.mock('../../src/events', () => ({
  eventBus: {
    publish: vi.fn(),
  },
  EventFactory: {
    createSystemEvent: vi.fn((type, data, source) => ({
      type,
      data,
      metadata: { source, timestamp: Date.now() },
    })),
  },
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('WebSocketConnectionManager', () => {
  let manager: WebSocketConnectionManager;
  const testUrl = 'wss://test.example.com';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (manager) {
      manager.disconnect();
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const status = manager.getStatus();

      expect(status.url).toBe(testUrl);
      expect(status.connected).toBe(false);
      expect(status.connecting).toBe(false);
      expect(status.reconnectAttempts).toBe(0);
    });

    it('should create manager with custom config', () => {
      manager = new WebSocketConnectionManager({
        url: testUrl,
        maxReconnectAttempts: 10,
        reconnectDelay: 2000,
        heartbeatInterval: 60000,
      });

      const status = manager.getStatus();
      expect(status.url).toBe(testUrl);
    });
  });

  describe('connect', () => {
    it('should connect to WebSocket', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      expect(manager.isConnected()).toBe(true);
      expect(manager.getStatus().connected).toBe(true);
    });

    it('should emit connected event', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const onConnected = vi.fn();
      manager.on('connected', onConnected);

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      expect(onConnected).toHaveBeenCalled();
    });

    it('should not connect if already connecting', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      const connectPromise1 = manager.connect();
      const connectPromise2 = manager.connect();
      
      await vi.advanceTimersByTimeAsync(0);
      await Promise.all([connectPromise1, connectPromise2]);

      // Should only create one WebSocket
      expect(manager.isConnected()).toBe(true);
    });

    it('should not connect if destroyed', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      manager.disconnect();

      await manager.connect();

      expect(manager.isConnected()).toBe(false);
    });

    it('should handle connection timeout', async () => {
      // Mock WebSocket that doesn't open
      const MockWS = (await import('ws')).default;
      const originalReadyState = MockWS.prototype.readyState;
      MockWS.prototype.readyState = MockWS.CONNECTING;

      manager = new WebSocketConnectionManager({ url: testUrl });

      await expect(manager.connect()).rejects.toThrow('Connection timeout');

      // Restore
      MockWS.prototype.readyState = originalReadyState;
    });
  });

  describe('disconnect', () => {
    it('should disconnect WebSocket', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      
      manager.disconnect();

      expect(manager.isConnected()).toBe(false);
      expect(manager.getStatus().connected).toBe(false);
    });

    it('should emit disconnected event', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const onDisconnected = vi.fn();
      manager.on('disconnected', onDisconnected);

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      manager.disconnect();

      expect(onDisconnected).toHaveBeenCalled();
    });

    it('should clear timers on disconnect', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      manager.disconnect();

      // Timers should be cleared
      expect(manager.getStatus().reconnectAttempts).toBe(0);
    });
  });

  describe('send', () => {
    it('should send message when connected', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const message = { method: 'test', params: [] };
      manager.send(message);

      const ws = (manager as any).ws;
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should throw error when not connected', () => {
      manager = new WebSocketConnectionManager({ url: testUrl });

      expect(() => {
        manager.send({ method: 'test' });
      }).toThrow('WebSocket is not connected');
    });
  });

  describe('subscribe', () => {
    it('should send subscription message', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const subscription = {
        method: 'subscribe',
        params: ['test'],
        id: 'sub-1',
      };
      manager.subscribe(subscription);

      const ws = (manager as any).ws;
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(subscription));
    });
  });

  describe('unsubscribe', () => {
    it('should send unsubscribe message', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      manager.unsubscribe('sub-1');

      const ws = (manager as any).ws;
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'sub-1',
          method: 'unsubscribe',
          params: ['sub-1'],
        })
      );
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      expect(manager.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.isConnected()).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return current status', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      
      let status = manager.getStatus();
      expect(status).toEqual({
        connected: false,
        connecting: false,
        reconnectAttempts: 0,
        url: testUrl,
      });

      const connectPromise = manager.connect();
      status = manager.getStatus();
      expect(status.connecting).toBe(true);

      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      status = manager.getStatus();
      expect(status.connected).toBe(true);
      expect(status.connecting).toBe(false);
    });
  });

  describe('event handlers', () => {
    it('should handle open event', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const onOpen = vi.fn();
      manager.on('open', onOpen);

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      expect(onOpen).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'websocket.connected',
          data: expect.objectContaining({ url: testUrl }),
        })
      );
    });

    it('should handle message event', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const onMessage = vi.fn();
      manager.on('message', onMessage);

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (manager as any).ws;
      const testMessage = { method: 'notification', params: { data: 'test' } };
      ws.emit('message', JSON.stringify(testMessage));

      expect(onMessage).toHaveBeenCalledWith(testMessage);
    });

    it('should handle invalid JSON message', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const onError = vi.fn();
      manager.on('error', onError);

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (manager as any).ws;
      ws.emit('message', 'invalid json');

      expect(onError).toHaveBeenCalled();
    });

    it('should handle close event and reconnect', async () => {
      manager = new WebSocketConnectionManager({
        url: testUrl,
        maxReconnectAttempts: 3,
        reconnectDelay: 1000,
      });

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (manager as any).ws;
      ws.emit('close', 1000, 'Normal closure');

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'websocket.disconnected',
        })
      );

      // Fast-forward to trigger reconnect
      await vi.advanceTimersByTimeAsync(1000);

      // Should attempt reconnection
      expect(manager.getStatus().reconnectAttempts).toBeGreaterThan(0);
    });

    it('should not reconnect if destroyed', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      manager.disconnect();

      const ws = (manager as any).ws;
      ws.emit('close', 1000, 'Normal closure');

      await vi.advanceTimersByTimeAsync(2000);

      expect(manager.getStatus().reconnectAttempts).toBe(0);
    });

    it('should handle error event', async () => {
      manager = new WebSocketConnectionManager({ url: testUrl });
      const onError = vi.fn();
      manager.on('error', onError);

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (manager as any).ws;
      const error = new Error('WebSocket error');
      ws.emit('error', error);

      expect(onError).toHaveBeenCalledWith(error);
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'websocket.error',
        })
      );
    });

    it('should stop reconnecting after max attempts', async () => {
      manager = new WebSocketConnectionManager({
        url: testUrl,
        maxReconnectAttempts: 2,
        reconnectDelay: 100,
      });

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (manager as any).ws;
      const onMaxAttempts = vi.fn();
      manager.on('maxReconnectAttemptsReached', onMaxAttempts);

      // Trigger multiple reconnections
      for (let i = 0; i < 3; i++) {
        ws.emit('close', 1000, 'Normal closure');
        await vi.advanceTimersByTimeAsync(100 * Math.pow(2, i));
      }

      expect(onMaxAttempts).toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat messages', async () => {
      manager = new WebSocketConnectionManager({
        url: testUrl,
        heartbeatInterval: 1000,
      });

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);

      const ws = (manager as any).ws;
      ws.send.mockClear();

      // Fast-forward past heartbeat interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ method: 'ping' }));
    });

    it('should not send heartbeat when disconnected', async () => {
      manager = new WebSocketConnectionManager({
        url: testUrl,
        heartbeatInterval: 1000,
      });

      await manager.connect();
      await vi.advanceTimersByTimeAsync(0);
      manager.disconnect();

      const ws = (manager as any).ws;
      ws.send.mockClear();

      await vi.advanceTimersByTimeAsync(1000);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});

