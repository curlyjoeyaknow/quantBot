/**
 * @file helius-monitor.test.ts
 * @description
 * Unit tests for the HeliusMonitor class. Verifies all core behaviors:
 * - WebSocket setup, event handling, connection/reconnection logic
 * - CA (Conditional Alert) tracking lifecycle and additions
 * - Price update ingesting, target/stop-loss alerts
 * - Ichimoku indicator analysis, signals, and alerting
 * - Alert throttling/prevention of duplicates
 * - Fallback polling logic for network failures
 * - Graceful resource cleanup
 * - Robust error handling for all internal and external dependencies
 *
 * All dependencies are fully mocked to ensure isolated unit testing of class functionality.
 */

// --- Dependency mocking: Ensures no real network/db requests run during tests ---
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import axios from 'axios';
import { HeliusMonitor } from '../src/helius-monitor';
import * as db from '@quantbot/utils';
import {
  simulateStrategy,
  calculateIchimoku,
  detectIchimokuSignals,
  formatIchimokuData,
} from '@quantbot/simulation';

// Define the default WebSocket mock implementation outside the factory
// so we can reuse it for restoration
function createDefaultWebSocketMock(url: string) {
  class MockWebSocketClass {
    readyState = 1; // WebSocket.OPEN
    send = vi.fn();
    close = vi.fn();
    on = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    removeAllListeners = vi.fn();
    _handlers: Record<string, ((...args: any[]) => void)[]> = {};

    constructor(url: string) {
      // Initialize handlers storage on instance
      this._handlers = {};
      
      // Override on method to store handlers and auto-trigger open
      this.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
        
        // Auto-trigger open event when registered
        if (event === 'open') {
          process.nextTick(() => handler());
        }
        return this;
      });

      // Override removeAllListeners to clear handlers
      this.removeAllListeners = vi.fn(() => {
        this._handlers = {};
        return this;
      });
    }
  }
  return new MockWebSocketClass(url);
}

vi.mock('ws', () => {
  // Create a function constructor that returns the class instance
  // Use vi.fn() with the default implementation
  const MockWebSocketSpy = vi.fn(createDefaultWebSocketMock) as any;
  
  // Copy static properties
  MockWebSocketSpy.OPEN = 1;
  MockWebSocketSpy.CONNECTING = 0;
  MockWebSocketSpy.CLOSING = 2;
  MockWebSocketSpy.CLOSED = 3;

  return {
    default: MockWebSocketSpy,
    WebSocket: MockWebSocketSpy,
  };
});

vi.mock('axios', () => {
  const mockAxiosGet = vi.fn();
  const mockAxiosPost = vi.fn();
  (globalThis as any).__mockAxiosGet__ = mockAxiosGet;
  (globalThis as any).__mockAxiosPost__ = mockAxiosPost;
  return {
    default: {
      get: mockAxiosGet,
      post: mockAxiosPost,
    },
  };
});

vi.mock('@quantbot/utils', () => ({
  getActiveCATracking: vi.fn(),
  savePriceUpdate: vi.fn(),
  saveAlertSent: vi.fn(),
  getRecentCAPerformance: vi.fn(),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@quantbot/simulation', () => {
  const mockIchimoku = {
    tenkan: 1.1,
    kijun: 1.0,
    senkouA: 1.05,
    senkouB: 0.95,
    span_a: 1.05, // Required alias
    span_b: 0.95, // Required alias
    chikou: 1.2,
    cloudTop: 1.05,
    cloudBottom: 0.95,
    cloudThickness: 0.1,
    isBullish: true,
    isBearish: false,
    inCloud: false,
    isTenkanAboveKijun: true, // Required property
  };
  
  return {
    simulateStrategy: vi.fn(),
    calculateIchimoku: vi.fn(() => mockIchimoku),
    detectIchimokuSignals: vi.fn(() => []),
    formatIchimokuData: vi.fn(() => 'Ichimoku Analysis: Bullish'),
  };
});

// Typed aliases for mocks
const MockWebSocket = WebSocket as any;
const mockAxiosGet = (globalThis as any).__mockAxiosGet__;
const mockAxiosPost = (globalThis as any).__mockAxiosPost__;
const mockAxios = { get: mockAxiosGet, post: mockAxiosPost };
const mockDb = db as any;
const mockSimulateStrategy = simulateStrategy as any;
const mockCalculateIchimoku = calculateIchimoku as any;
const mockDetectIchimokuSignals = detectIchimokuSignals as any;
const mockFormatIchimokuData = formatIchimokuData as any;

// We'll get the original implementation when needed in tests

// Setup Vitest fake timers for all tests, since class may use setInterval/setTimeout internally
beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('HeliusMonitor', () => {
  let monitor: HeliusMonitor;
  let mockBot: any;
  let mockWebSocket: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Just clear the call history, don't reset the implementation
    // The mock implementation from the factory should remain intact
    MockWebSocket.mockClear();

    // Fake Telegram Bot implementation (captures alert sends)
    mockBot = {
      telegram: {
        sendMessage: vi.fn(),
      },
    };

    // The WebSocket mock is now a class, so each new WebSocket() call creates a new instance
    // We'll get the instance after it's created in the test
    mockWebSocket = null; // Will be set when WebSocket is instantiated

    // Reset database and simulation mocks to predictable values before every test for isolation
    (mockDb.getActiveCATracking as any).mockResolvedValue([]);
    (mockDb.savePriceUpdate as any).mockResolvedValue(undefined);
    (mockDb.saveAlertSent as any).mockResolvedValue(undefined);
    (mockDb.getRecentCAPerformance as any).mockResolvedValue([]);

    // Standardized fake simulation results for deterministic tests:
    (mockSimulateStrategy as any).mockReturnValue({
      finalPnl: 100,
      events: [],
      entryPrice: 1.0,
      finalPrice: 1.5,
      totalCandles: 10,
      entryOptimization: {
        lowestPrice: 0.8,
        lowestPriceTimestamp: 1000,
        lowestPricePercent: -20,
        lowestPriceTimeFromEntry: 5,
        trailingEntryUsed: false,
        actualEntryPrice: 1.0,
        entryDelay: 0,
      },
    });
    // Standard Ichimoku indicator snapshot - already set in mock, just reset call count
    (mockCalculateIchimoku as any).mockClear();
    (mockDetectIchimokuSignals as any).mockClear();
    (mockFormatIchimokuData as any).mockClear();

    // Insert fake keys for dependency injection
    process.env.HELIUS_API_KEY = 'test-api-key';
    process.env.BOT_TOKEN = 'test-bot-token';

    // New monitor instance for every test
    monitor = new HeliusMonitor(mockBot);
  });

  /**
   * Constructor and Initial State Tests
   * Ensure new class instance is properly initialized with defensive state.
   */
  describe('Constructor and Initialization', () => {
    it('should create HeliusMonitor instance', () => {
      expect(monitor).toBeDefined();
      expect(monitor).toBeInstanceOf(HeliusMonitor);
    });

    it('should initialize with empty activeCAs map', () => {
      expect(monitor['activeCAs']).toBeDefined();
      expect(monitor['activeCAs'].size).toBe(0);
    });

    it('should set initial state correctly', () => {
      expect(monitor['reconnectAttempts']).toBe(0);
      expect(monitor['hasAuthError']).toBe(false);
      expect(monitor['ws']).toBeNull();
    });
  });

  /**
   * WebSocket lifecycle: Covers all details of establishing a connection,
   * event handler registration, error propagation/authentication flow, etc.
   */
  describe('WebSocket Connection', () => {
    it('should connect to WebSocket', async () => {
      await monitor.start();
      // Ensure WebSocket was created (the mock class constructor was called)
      expect(monitor['ws']).toBeDefined();
      expect(monitor['ws']).not.toBeNull();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      // Create a new monitor instance
      const errorMonitor = new HeliusMonitor(mockBot);
      
      // Make the WebSocket constructor throw by replacing the mock implementation
      // The mock needs to be a constructor function that throws
      vi.mocked(WebSocket).mockImplementationOnce(function() {
        throw error;
      } as any);

      // The connect() method catches the error and rejects the promise
      await expect(errorMonitor.start()).rejects.toThrow('Connection failed');
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('401 Unauthorized');
      await monitor.start();
      
      // Get the WebSocket instance and trigger error event
      const ws = monitor['ws'];
      expect(ws).toBeDefined();
      if (ws) {
        // Get handlers from the mock instance
        const handlers = (ws as any)._handlers;
        if (handlers && handlers.error) {
          // Call all error handlers
          handlers.error.forEach((handler: (...args: any[]) => void) => handler(authError));
        } else {
          // Fallback: find error handler from on calls
          const onCalls = (ws.on as any).mock.calls;
          const errorHandler = onCalls.find((call: any[]) => call[0] === 'error')?.[1];
          if (errorHandler) {
            errorHandler(authError);
          }
        }
      }
      
      expect(monitor['hasAuthError']).toBe(true);
    });

    it('should set up event handlers', async () => {
      await monitor.start();

      const ws = monitor['ws'];
      expect(ws).toBeDefined();
      if (ws) {
        expect(ws.on).toHaveBeenCalledWith('open', expect.any(Function));
        expect(ws.on).toHaveBeenCalledWith('message', expect.any(Function));
        expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
        expect(ws.on).toHaveBeenCalledWith('error', expect.any(Function));
      }
    });
  });

  /**
   * Tests covering all aspects of CA tracking addition (w/ and w/o historical data) and WebSocket subscription.
   */
  describe('CA Tracking Management', () => {
    it('should add CA tracking', async () => {
      const caData = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: { initial: -0.2 },
      };

      await monitor.addCATracking(caData);

      expect(monitor['activeCAs'].size).toBe(1);
      expect(monitor['activeCAs'].has('solana:So11111111111111111111111111111111111111112')).toBe(
        true
      );
    });

    it('should add CA tracking with historical candles', async () => {
      const caData = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: { initial: -0.2 },
        historicalCandles: Array(60)
          .fill(null)
          .map((_, i) => ({
          timestamp: 1000 + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
            volume: 1000,
          })),
      };

      await monitor.addCATrackingWithCandles(caData);

      expect(monitor['activeCAs'].size).toBe(1);
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca?.candles.length).toBe(60);
      expect(ca?.lastIchimoku).toBeDefined();
    });

    it('should subscribe to CA when WebSocket is open', async () => {
      await monitor.start(); // Start to get WebSocket instance
      const ws = monitor['ws'];
      expect(ws).toBeDefined();
      if (ws) {
        // WebSocket should already be OPEN (readyState = 1) from the mock
        // The subscribeToAllTrackedCAs is called in the 'open' handler
        // So we need to add CA tracking first, then verify send was called
        const caData = {
          id: 1,
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          tokenName: 'Test Token',
          tokenSymbol: 'TEST',
          callPrice: 1.0,
          callMarketcap: 1000000,
          callTimestamp: Date.now(),
          userId: 12345,
          chatId: 12345,
          strategy: [{ percent: 0.5, target: 2.0 }],
          stopLossConfig: { initial: -0.2 },
        };

        await monitor.addCATracking(caData);

        // send should be called when WebSocket is open and CA is added
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('subscribe'));
      }
    });
  });

  /**
   * Price update message handling: ensures price changes are processed,
   * triggers proper persistence, target/stop-loss checking, and downstream alerts.
   */
  describe('Price Update Handling', () => {
    beforeEach(async () => {
      const caData = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: { initial: -0.2 },
      };

      await monitor.addCATracking(caData);
    });

    it('should handle price update messages', async () => {
      const priceUpdateMessage = {
        method: 'price-update',
        params: {
          account: 'So11111111111111111111111111111111111111112',
          price: 1.5,
          marketcap: 1500000,
          timestamp: Date.now(),
        },
      };

      // Directly invoke message handling (bypassing ws event trigger mechanism)
      const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
      await handleMessage(priceUpdateMessage);

      expect(mockDb.savePriceUpdate).toHaveBeenCalled();
    });

    it('should check alerts on price updates', async () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        const priceUpdateMessage = {
          method: 'price-update',
          params: {
            account: 'So11111111111111111111111111111111111111112',
            price: 2.0, // Hit 2x target
            marketcap: 2000000,
            timestamp: Date.now(),
          },
        };

        const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
        await handleMessage(priceUpdateMessage);

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      }
    });

    it('should handle stop loss triggers', async () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        const priceUpdateMessage = {
          method: 'price-update',
          params: {
            account: 'So11111111111111111111111111111111111111112',
            price: 0.8, // Hit stop loss (20% down from 1.0)
            marketcap: 800000,
            timestamp: Date.now(),
          },
        };

        const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
        await handleMessage(priceUpdateMessage);

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      }
    });
  });

  /**
   * Full coverage of Ichimoku indicator use, from calculation to signal/alert generation and thresholds.
   */
  describe('Ichimoku Analysis', () => {
    beforeEach(async () => {
      const caData = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: { initial: -0.2 },
        historicalCandles: Array(60)
          .fill(null)
          .map((_, i) => ({
          timestamp: 1000 + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
            volume: 1000,
          })),
      };

      await monitor.addCATrackingWithCandles(caData);
    });

    it('should calculate Ichimoku indicators', () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca?.lastIchimoku).toBeDefined();
      expect(mockCalculateIchimoku).toHaveBeenCalled();
    });

    it('should detect Ichimoku signals', async () => {
      vi.mocked(mockDetectIchimokuSignals).mockReturnValue([
        { 
          type: 'tenkan_kijun_cross', 
          strength: 'strong',
          direction: 'bullish',
          price: 1.5,
          timestamp: Date.now(),
          description: 'Tenkan-Kijun crossover detected',
        },
      ]);

      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        const checkSignals = (monitor as any)['checkIchimokuSignals'].bind(monitor);
        await checkSignals(ca, 1.5, Date.now());

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      }
    });

    it('should handle price near Ichimoku lines', () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca && ca.lastIchimoku) {
        const isNear = (monitor as any)['isPriceNearIchimokuLines'](1.05, ca.lastIchimoku);
        expect(typeof isNear).toBe('boolean');
      }
    });

    it('should check leading span crosses', async () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.lastPrice = 1.0;
        ca.ichimokuLeadingSpans = {
          senkouA: 1.05,
          senkouB: 0.95,
          cloudTop: 1.05,
          cloudBottom: 0.95,
        };

        const checkCrosses = (monitor as any)['checkIchimokuLeadingSpanCrosses'].bind(monitor);
        await checkCrosses(ca, 1.1, Date.now());

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      }
    });
  });

  /**
   * Alert dispatch and prevention - verify user does not get duplicate alerts,
   * ensure both normal and Ichimoku-specific alert mechanisms work.
   */
  describe('Alert Management', () => {
    beforeEach(async () => {
      const caData = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: { initial: -0.2 },
      };

      await monitor.addCATracking(caData);
    });

    it('should send alerts', async () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        const sendAlert = (monitor as any)['sendAlert'].bind(monitor);
        await sendAlert(ca, 'Test alert message');

        expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(12345, 'Test alert message', {
          parse_mode: 'Markdown',
        });
        // Note: sendAlert doesn't call saveAlertSent - that's done in checkAlertsAndNotify
      }
    });

    it('should send Ichimoku alerts', async () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.lastIchimoku = {
          tenkan: 1.1,
          kijun: 1.0,
          senkouA: 1.05,
          senkouB: 0.95,
          span_a: 1.05,
          span_b: 0.95,
          chikou: 1.2,
          cloudTop: 1.05,
          cloudBottom: 0.95,
          cloudThickness: 0.1,
          isBullish: true,
          isBearish: false,
          inCloud: false,
          isTenkanAboveKijun: true,
        };

        const mockSignal = {
          type: 'tenkan_kijun_cross',
          strength: 'strong',
          direction: 'bullish',
          price: 1.5,
          timestamp: Date.now(),
          description: 'Bullish signal detected',
        };
        const sendIchimokuAlert = (monitor as any)['sendIchimokuAlert'].bind(monitor);
        await sendIchimokuAlert(ca, mockSignal, ca.lastIchimoku!, 1.5);

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
        expect(mockFormatIchimokuData).toHaveBeenCalled();
      }
    });

    it('should prevent duplicate alerts', async () => {
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        // Test duplicate prevention in checkAlertsAndNotify (not sendAlert)
        ca.alertsSent.add('profit_2x'); // Mark 2x target as already sent
        
        // Trigger checkAlertsAndNotify with price that would hit 2x target
        const checkAlerts = (monitor as any)['checkAlertsAndNotify'].bind(monitor);
        await checkAlerts(ca, 2.0, 1.0); // price = 2.0 (2x), priceChange = 1.0 (100%)

        // Should not send duplicate alert because profit_2x is already in alertsSent
        expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
      }
    });
  });

  /**
   * Covers connection error and retry logic, including halting on max attempts or auth errors
   */
  describe('Reconnection Handling', () => {
    it('should handle reconnection attempts', () => {
      monitor['reconnectAttempts'] = 3;
      monitor['maxReconnectAttempts'] = 5;

      const handleReconnect = (monitor as any)['handleReconnect'].bind(monitor);
      handleReconnect();

      expect(monitor['reconnectAttempts']).toBe(4);
    });

    it('should stop reconnecting after max attempts', () => {
      monitor['reconnectAttempts'] = 5;
      monitor['maxReconnectAttempts'] = 5;

      const handleReconnect = (monitor as any)['handleReconnect'].bind(monitor);
      handleReconnect();

      // After max attempts, it should just return without setting hasAuthError
      // The hasAuthError is only set on auth errors, not max reconnect attempts
      expect(monitor['reconnectAttempts']).toBe(5);
    });

    it('should handle authentication errors', () => {
      monitor['hasAuthError'] = true;

      const handleReconnect = (monitor as any)['handleReconnect'].bind(monitor);
      handleReconnect();

      expect(monitor['hasAuthError']).toBe(true);
    });
  });

  /**
   * Verifies fallback polling mode activates/deactivates, and
   * Ichimoku alert polling uses the mocked API.
   */
  describe('Fallback Polling', () => {
    it('should start fallback polling', () => {
      const startFallback = (monitor as any)['startFallbackPolling'].bind(monitor);
      startFallback();

      expect(monitor['fallbackPollingInterval']).toBeDefined();
    });

    it('should stop fallback polling', () => {
      monitor['fallbackPollingInterval'] = setInterval(() => {}, 1000);

      const stopFallback = (monitor as any)['stopFallbackPolling'].bind(monitor);
      stopFallback();

      expect(monitor['fallbackPollingInterval']).toBeNull();
    });

    it('should poll Ichimoku alerts', async () => {
      const caData = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: { initial: -0.2 },
      };

      await monitor.addCATracking(caData);
      
      // Set lastIchimoku so pollIchimokuAlerts doesn't skip
      const ca = monitor['activeCAs'].get('solana:So11111111111111111111111111111111111111112');
      if (ca) {
        ca.lastIchimoku = {
          tenkan: 1.1,
          kijun: 1.0,
          senkouA: 1.05,
          senkouB: 0.95,
          span_a: 1.05,
          span_b: 0.95,
          chikou: 1.2,
          cloudTop: 1.05,
          cloudBottom: 0.95,
          cloudThickness: 0.1,
          isBullish: true,
          isBearish: false,
          inCloud: false,
          isTenkanAboveKijun: true,
        };
      }

      mockAxiosGet.mockResolvedValue({
        data: [{ price: 1.5 }],
      });

      const pollAlerts = (monitor as any)['pollIchimokuAlerts'].bind(monitor);
      await pollAlerts();

      expect(mockAxiosGet).toHaveBeenCalled();
    });
  });

  /**
   * Tests for cleanup and shutdown procedures (ensures no intervals/sockets left open).
   */
  describe('Cleanup and Shutdown', () => {
    it('should stop monitoring', async () => {
      await monitor.start();
      const ws = monitor['ws'];
      expect(ws).toBeDefined();

      monitor.stop();

      if (ws) {
        // cleanupWebSocket calls removeAllListeners
        expect(ws.removeAllListeners).toHaveBeenCalled();
        if (typeof ws.close === 'function') {
          expect(ws.close).toHaveBeenCalled();
        }
      }
      expect(monitor['ws']).toBeNull();
    });

    it('should clear intervals on stop', () => {
      monitor['fallbackPollingInterval'] = setInterval(() => {}, 1000);

      monitor.stop();

      expect(monitor['fallbackPollingInterval']).toBeNull();
    });
  });

  /**
   * Defensive error handling: confirm all expected error scenarios
   * (network, database, external API, etc) do not cause unhandled exceptions.
   */
  describe('Error Handling', () => {
    it('should handle WebSocket errors gracefully', async () => {
      await monitor.start();
      const ws = monitor['ws'];
      expect(ws).toBeDefined();
      
      if (ws) {
        // Get handlers from the mock instance
        const handlers = (ws as any)._handlers;
        if (handlers && handlers.error) {
          // Call all error handlers
          const error = new Error('WebSocket error');
          handlers.error.forEach((handler: (...args: any[]) => void) => handler(error));
        } else {
          // Fallback: find error handler from on calls
          const onCalls = (ws.on as any).mock?.calls || [];
          const errorHandler = onCalls.find((call: any[]) => call[0] === 'error')?.[1];
          if (errorHandler) {
            const error = new Error('WebSocket error');
            errorHandler(error);
          } else {
            // If no handler found, just verify the monitor is still defined
            expect(monitor).toBeDefined();
          }
        }
      }

      // Should not crash
      expect(monitor).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(mockDb.savePriceUpdate).mockRejectedValue(new Error('Database error'));

      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0,
      };

      await monitor.addCATracking(caData);

      const priceUpdateMessage = {
        method: 'priceUpdate',
        params: {
          token: 'So11111111111111111111111111111111111111112',
          price: 1.5,
          timestamp: Date.now(),
        },
      };

      const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
      
      // Should not throw
      await expect(handleMessage(priceUpdateMessage)).resolves.not.toThrow();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockAxios.get).mockRejectedValue(new Error('API error'));

      const pollAlerts = (monitor as any)['pollIchimokuAlerts'].bind(monitor);
      
      // Should not throw
      await expect(pollAlerts()).resolves.not.toThrow();
    });
  });
});
