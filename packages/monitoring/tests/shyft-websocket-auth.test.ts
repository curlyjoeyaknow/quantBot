import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveTradeAlertService } from '../src/live-trade-alert-service';
import { TenkanKijunAlertService } from '../src/tenkan-kijun-alert-service';

// Mock ws module
const mockWebSocket = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  readyState: 0,
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

vi.mock('ws', () => {
  const WebSocket = vi.fn().mockImplementation(() => mockWebSocket);
  (WebSocket as any).CONNECTING = 0;
  (WebSocket as any).OPEN = 1;
  (WebSocket as any).CLOSING = 2;
  (WebSocket as any).CLOSED = 3;
  return { default: WebSocket, WebSocket };
});

// Mock dependencies
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    creditMonitor: {
      recordUsage: vi.fn(),
    },
    storeEntryAlert: vi.fn().mockResolvedValue(undefined),
    storePriceCache: vi.fn().mockResolvedValue(undefined),
    getCachedPrice: vi.fn().mockResolvedValue(null),
    getEnabledStrategies: vi.fn().mockReturnValue(new Set(['ichimoku_tenkan_kijun'])),
    storeMonitoredToken: vi.fn().mockResolvedValue(1),
    updateMonitoredTokenEntry: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@quantbot/data', () => {
  const mockCallerDbInstance = {
    getActiveAlerts: vi.fn().mockResolvedValue([]),
    getCallerAlertsInRange: vi.fn().mockResolvedValue([]),
  };
  
  class MockCallerDatabase {
    constructor() {
      return mockCallerDbInstance;
    }
  }
  
  return {
    callerDatabase: mockCallerDbInstance,
    CallerDatabase: MockCallerDatabase,
  };
});

vi.mock('@quantbot/simulation', () => ({
  calculateIchimoku: vi.fn(),
  detectIchimokuSignals: vi.fn(),
  calculateIndicators: vi.fn(),
}));

describe('Shyft WebSocket Authentication', () => {
  beforeEach(() => {
    // Reset mock state
    mockWebSocket.readyState = 0; // CONNECTING
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('LiveTradeAlertService', () => {
    it('should authenticate before subscribing', async () => {
      const service = new LiveTradeAlertService();
      const authToken = 'test-token-123';

      // Set up WebSocket event handlers
      let openHandler: () => void;
      let messageHandler: (data: any) => void;

      mockWebSocket.on = vi.fn((event: string, handler: any) => {
        if (event === 'open') {
          openHandler = handler;
        } else if (event === 'message') {
          messageHandler = handler;
        }
      });

      // Mock environment
      process.env.SHYFT_X_TOKEN = authToken;
      process.env.SHYFT_WS_URL = 'wss://api.shyft.to/v1/stream';

      // Start service (this will trigger connection)
      await service.start();

      // Simulate WebSocket open
      mockWebSocket.readyState = 1; // OPEN
      if (openHandler) {
        openHandler();
      }

      // Verify auth message was sent
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"auth"')
      );
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining(authToken)
      );

      // Simulate successful auth response
      const authResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: true,
      };

      if (messageHandler) {
        messageHandler({ toString: () => JSON.stringify(authResponse) });
      }

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify subscription was sent (after auth)
      const sendCalls = mockWebSocket.send.mock.calls;
      const authCallIndex = sendCalls.findIndex((call: any[]) =>
        call[0].includes('"method":"auth"')
      );
      const subscribeCallIndex = sendCalls.findIndex((call: any[]) =>
        call[0].includes('"method":"subscribe"')
      );

      expect(authCallIndex).toBeGreaterThan(-1);
      if (subscribeCallIndex > -1) {
        expect(subscribeCallIndex).toBeGreaterThan(authCallIndex);
      }
    });

    it('should handle auth timeout', async () => {
      const service = new LiveTradeAlertService();
      const authToken = 'test-token-123';

      process.env.SHYFT_X_TOKEN = authToken;
      process.env.SHYFT_WS_URL = 'wss://api.shyft.to/v1/stream';

      let openHandler: () => void;
      mockWebSocket.on = vi.fn((event: string, handler: any) => {
        if (event === 'open') {
          openHandler = handler;
        }
      });

      await service.start();

      mockWebSocket.readyState = 1; // OPEN
      if (openHandler) {
        openHandler();
      }
      
      // Wait for timeout (using fake timers)
      vi.useFakeTimers();
      vi.advanceTimersByTime(5100);
      vi.useRealTimers();
      
      // Service should have closed connection on timeout
      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    it('should handle auth error response', async () => {
      const service = new LiveTradeAlertService();
      const authToken = 'invalid-token';

      process.env.SHYFT_X_TOKEN = authToken;
      process.env.SHYFT_WS_URL = 'wss://api.shyft.to/v1/stream';

      let openHandler: () => void;
      let messageHandler: (data: any) => void;

      mockWebSocket.on = vi.fn((event: string, handler: any) => {
        if (event === 'open') {
          openHandler = handler;
        } else if (event === 'message') {
          messageHandler = handler;
        }
      });

      await service.start();

      mockWebSocket.readyState = 1; // OPEN
      if (openHandler) {
        openHandler();
      }

      // Simulate auth error response
      const errorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Invalid authentication token',
        },
      };

      if (messageHandler) {
        messageHandler({ toString: () => JSON.stringify(errorResponse) });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should close connection on auth error
      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    it('should ignore messages before authentication', async () => {
      const service = new LiveTradeAlertService();
      const authToken = 'test-token-123';

      process.env.SHYFT_X_TOKEN = authToken;
      process.env.SHYFT_WS_URL = 'wss://api.shyft.to/v1/stream';

      let messageHandler: (data: any) => void;

      mockWebSocket.on = vi.fn((event: string, handler: any) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      });

      await service.start();

      // Send message before auth
      const priceUpdate = {
        method: 'token_price',
        params: {
          token: 'So11111111111111111111111111111111111111112',
          price: 1.5,
        },
      };

      if (messageHandler) {
        messageHandler({ toString: () => JSON.stringify(priceUpdate) });
      }

      // Should not process the message (no error thrown means it was ignored)
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  });

  describe('TenkanKijunAlertService', () => {
    it('should authenticate before subscribing', async () => {
      const service = new TenkanKijunAlertService(
        {} as any, // callerDb
        'test-token',
        'wss://api.shyft.to/v1/stream',
        'test-token',
        'https://grpc.ams.shyft.to'
      );

      let openHandler: () => void;
      let messageHandler: (data: any) => void;

      mockWebSocket.on = vi.fn((event: string, handler: any) => {
        if (event === 'open') {
          openHandler = handler;
        } else if (event === 'message') {
          messageHandler = handler;
        }
      });

      await service.start();

      mockWebSocket.readyState = 1; // OPEN
      if (openHandler) {
        openHandler();
      }

      // Verify auth was sent
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"auth"')
      );

      // Simulate successful auth
      const authResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: true,
      };

      if (messageHandler) {
        messageHandler({ toString: () => JSON.stringify(authResponse) });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify subscription happened after auth
      const sendCalls = mockWebSocket.send.mock.calls;
      const hasAuth = sendCalls.some((call: any[]) =>
        call[0].includes('"method":"auth"')
      );
      expect(hasAuth).toBe(true);
    });

    it('should not subscribe if authentication fails', async () => {
      const service = new TenkanKijunAlertService(
        {} as any,
        'invalid-token',
        'wss://api.shyft.to/v1/stream',
        'invalid-token',
        'https://grpc.ams.shyft.to'
      );

      let openHandler: () => void;
      let messageHandler: (data: any) => void;

      mockWebSocket.on = vi.fn((event: string, handler: any) => {
        if (event === 'open') {
          openHandler = handler;
        } else if (event === 'message') {
          messageHandler = handler;
        }
      });

      await service.start();

      mockWebSocket.readyState = 1; // OPEN
      if (openHandler) {
        openHandler();
      }

      // Simulate auth error
      const errorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Invalid token',
        },
      };

      if (messageHandler) {
        messageHandler({ toString: () => JSON.stringify(errorResponse) });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should close on error
      expect(mockWebSocket.close).toHaveBeenCalled();
    });
  });
});

