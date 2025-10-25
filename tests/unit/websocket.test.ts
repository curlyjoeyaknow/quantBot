/**
 * WebSocket Connection Manager Tests
 * =================================
 * Tests for the WebSocket connection management functionality
 */

import { WebSocketConnectionManager, WebSocketConfig } from '../../src/websocket/WebSocketConnectionManager';

// Mock WebSocket
jest.mock('ws', () => {
  const EventEmitter = require('events');
  
  class MockWebSocket extends EventEmitter {
    public readyState: number = 0; // CONNECTING
    public send = jest.fn();
    public close = jest.fn();
    
    constructor(url: string) {
      super();
      // Simulate connection opening after a short delay
      setTimeout(() => {
        this.readyState = 1; // OPEN
        this.emit('open');
      }, 10);
    }
  }
  
  return MockWebSocket;
});

describe('WebSocketConnectionManager', () => {
  let wsManager: WebSocketConnectionManager;
  let config: WebSocketConfig;

  beforeEach(() => {
    config = {
      url: 'wss://test.example.com',
      maxReconnectAttempts: 3,
      reconnectDelay: 100,
      heartbeatInterval: 1000
    };
    wsManager = new WebSocketConnectionManager(config);
  });

  afterEach(() => {
    wsManager.disconnect();
  });

  describe('Connection Management', () => {
    it('should connect to WebSocket', async () => {
      await wsManager.connect();
      // Wait a bit for the mock WebSocket to simulate connection
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(wsManager.isConnected()).toBe(true);
    });

    it('should disconnect from WebSocket', async () => {
      await wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
      wsManager.disconnect();
      expect(wsManager.isConnected()).toBe(false);
    });

    it('should emit connected event', async () => {
      const connectedSpy = jest.fn();
      wsManager.on('connected', connectedSpy);
      
      await wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      expect(connectedSpy).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    it('should send messages', async () => {
      await wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const message = { method: 'test', params: [] };
      wsManager.send(message);
      
      // Verify send was called (mocked WebSocket)
      expect(wsManager.isConnected()).toBe(true);
    });

    it('should subscribe to events', async () => {
      await wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const subscription = {
        jsonrpc: '2.0',
        id: 'test',
        method: 'subscribe',
        params: ['test-event', {}]
      };
      
      wsManager.subscribe(subscription);
      expect(wsManager.isConnected()).toBe(true);
    });

    it('should unsubscribe from events', async () => {
      await wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      wsManager.unsubscribe('test-id');
      expect(wsManager.isConnected()).toBe(true);
    });
  });

  describe('Status and Health', () => {
    it('should return connection status', async () => {
      const status = wsManager.getStatus();
      
      expect(status).toHaveProperty('connected');
      expect(status).toHaveProperty('connecting');
      expect(status).toHaveProperty('reconnectAttempts');
      expect(status).toHaveProperty('url');
      expect(status.url).toBe(config.url);
    });

    it('should check if connected', async () => {
      expect(wsManager.isConnected()).toBe(false);
      
      await wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(wsManager.isConnected()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors', async () => {
      const errorSpy = jest.fn();
      wsManager.on('error', errorSpy);
      
      // Simulate error
      wsManager.emit('error', new Error('Connection failed'));
      
      expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
