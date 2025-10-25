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
jest.mock('ws');
jest.mock('axios');
jest.mock('../../src/utils/database');
jest.mock('../../src/simulation/engine');
jest.mock('../../src/simulation/ichimoku');

import WebSocket from 'ws';
import axios from 'axios';
import { HeliusMonitor } from '../../src/helius-monitor';
import * as db from '../../src/utils/database';
import { simulateStrategy } from '../../src/simulation/engine';
import { calculateIchimoku, detectIchimokuSignals, formatIchimokuData } from '../../src/simulation/ichimoku';

// Typed aliases for mocks, for strong TypeScript/IDE hints
const MockWebSocket = WebSocket as unknown as jest.MockedClass<typeof WebSocket>;
const mockAxios = axios as unknown as jest.Mocked<typeof axios>;
const mockDb = db as unknown as jest.Mocked<typeof db>;
const mockSimulateStrategy = simulateStrategy as unknown as jest.MockedFunction<typeof simulateStrategy>;
const mockCalculateIchimoku = calculateIchimoku as unknown as jest.MockedFunction<typeof calculateIchimoku>;
const mockDetectIchimokuSignals = detectIchimokuSignals as unknown as jest.MockedFunction<typeof detectIchimokuSignals>;
const mockFormatIchimokuData = formatIchimokuData as unknown as jest.MockedFunction<typeof formatIchimokuData>;

// Setup Jest fake timers for all tests, since class may use setInterval/setTimeout internally
beforeAll(() => {
  jest.useFakeTimers({ legacyFakeTimers: true });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('HeliusMonitor', () => {
  let monitor: HeliusMonitor;
  let mockBot: any;
  let mockWebSocket: jest.Mocked<WebSocket>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Fake Telegram Bot implementation (captures alert sends)
    mockBot = {
      telegram: {
        sendMessage: jest.fn()
      }
    };

    // Stand-in mock for WebSocket: controls event triggers, readyState, and enables expectations on send/close/on
    mockWebSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
    } as any;

    // Patch WebSocket constructor to always produce the above mock
    (MockWebSocket as any).mockImplementation(() => mockWebSocket);

    // Reset database and simulation mocks to predictable values before every test for isolation
    mockDb.getActiveCATracking.mockResolvedValue([]);
    mockDb.savePriceUpdate.mockResolvedValue(undefined);
    mockDb.saveAlertSent.mockResolvedValue(undefined);
    mockDb.getRecentCAPerformance.mockResolvedValue([]);

    // Standardized fake simulation results for deterministic tests:
    mockSimulateStrategy.mockReturnValue({
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
    // Standard Ichimoku indicator snapshot
    mockCalculateIchimoku.mockReturnValue({
      tenkan: 1.1,
      kijun: 1.0,
      senkouA: 1.05,
      senkouB: 0.95,
      chikou: 1.2,
      cloudTop: 1.05,
      cloudBottom: 0.95,
      cloudThickness: 0.1,
      isBullish: true,
      isBearish: false,
      inCloud: false,
    });

    mockDetectIchimokuSignals.mockReturnValue([]);
    mockFormatIchimokuData.mockReturnValue('Ichimoku Analysis: Bullish');

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
      // Ensure created with correct endpoint
      expect(MockWebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://atlas-mainnet.helius-rpc.com')
      );
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      (MockWebSocket as any).mockImplementation(() => {
        throw error;
      });

      await expect(monitor.start()).rejects.toThrow('Connection failed');
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('401 Unauthorized');
      mockWebSocket.on.mockImplementation((event: string | symbol, callback: Function) => {
        if (event === 'error') {
          callback.call(mockWebSocket, authError);
        }
        return mockWebSocket;
      });

      await monitor.start();
      expect(monitor['hasAuthError']).toBe(true);
    });

    it('should set up event handlers', async () => {
      await monitor.start();

      expect(mockWebSocket.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  /**
   * Tests covering all aspects of CA tracking addition (w/ and w/o historical data) and WebSocket subscription.
   */
  describe('CA Tracking Management', () => {
    it('should add CA tracking', async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0
      };

      await monitor.addCATracking(caData);

      expect(monitor['activeCAs'].size).toBe(1);
      expect(monitor['activeCAs'].has('So11111111111111111111111111111111111111112')).toBe(true);
    });

    it('should add CA tracking with historical candles', async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0,
        historicalCandles: Array(60).fill(null).map((_, i) => ({
          timestamp: 1000 + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000
        }))
      };

      await monitor.addCATrackingWithCandles(caData);

      expect(monitor['activeCAs'].size).toBe(1);
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca?.candles.length).toBe(60);
      expect(ca?.lastIchimoku).toBeDefined();
    });

    it('should subscribe to CA when WebSocket is open', async () => {
      monitor['ws'] = mockWebSocket;
      Object.defineProperty(mockWebSocket, 'readyState', { value: WebSocket.OPEN, writable: true });

      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0
      };

      await monitor.addCATracking(caData);

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('subscribe')
      );
    });
  });

  /**
   * Price update message handling: ensures price changes are processed,
   * triggers proper persistence, target/stop-loss checking, and downstream alerts.
   */
  describe('Price Update Handling', () => {
    beforeEach(async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0
      };

      await monitor.addCATracking(caData);
    });

    it('should handle price update messages', async () => {
      const priceUpdateMessage = {
        method: 'priceUpdate',
        params: {
          token: 'So11111111111111111111111111111111111111112',
          price: 1.5,
          timestamp: Date.now()
        }
      };

      // Directly invoke message handling (bypassing ws event trigger mechanism)
      const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
      await handleMessage(priceUpdateMessage);

      expect(mockDb.savePriceUpdate).toHaveBeenCalled();
    });

    it('should check alerts on price updates', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.strategy = [{ percent: 0.5, target: 2.0 }];
        (ca as any).entryPrice = 1.0;

        const priceUpdateMessage = {
          method: 'priceUpdate',
          params: {
            token: 'So11111111111111111111111111111111111111112',
            price: 2.0, // Hit 2x target
            timestamp: Date.now()
          }
        };

        const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
        await handleMessage(priceUpdateMessage);

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      }
    });

    it('should handle stop loss triggers', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        (ca as any).stopLoss = -0.2; // -20% stop loss
        (ca as any).entryPrice = 1.0;

        const priceUpdateMessage = {
          method: 'priceUpdate',
          params: {
            token: 'So11111111111111111111111111111111111111112',
            price: 0.8, // Hit stop loss
            timestamp: Date.now()
          }
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
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0,
        historicalCandles: Array(60).fill(null).map((_, i) => ({
          timestamp: 1000 + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000
        }))
      };

      await monitor.addCATrackingWithCandles(caData);
    });

    it('should calculate Ichimoku indicators', () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca?.lastIchimoku).toBeDefined();
      expect(mockCalculateIchimoku).toHaveBeenCalled();
    });

    it('should detect Ichimoku signals', async () => {
      mockDetectIchimokuSignals.mockReturnValue([
        { 
          type: 'tenkan_kijun_cross', 
          strength: 'strong',
          direction: 'bullish',
          price: 1.5,
          timestamp: Date.now(),
          description: 'Tenkan-Kijun crossover detected'
        }
      ]);

      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        const checkSignals = (monitor as any)['checkIchimokuSignals'].bind(monitor);
        await checkSignals(ca, 1.5, Date.now());

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      }
    });

    it('should handle price near Ichimoku lines', () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca && ca.lastIchimoku) {
        const isNear = (monitor as any)['isPriceNearIchimokuLines'](1.05, ca.lastIchimoku);
        expect(typeof isNear).toBe('boolean');
      }
    });

    it('should check leading span crosses', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.lastPrice = 1.0;
        ca.ichimokuLeadingSpans = {
          senkouA: 1.05,
          senkouB: 0.95,
          cloudTop: 1.05,
          cloudBottom: 0.95
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
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0
      };

      await monitor.addCATracking(caData);
    });

    it('should send alerts', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        const sendAlert = (monitor as any)['sendAlert'].bind(monitor);
        await sendAlert(ca, 'Test alert message');

        expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
          12345,
          expect.stringContaining('Test alert message')
        );
        expect(mockDb.saveAlertSent).toHaveBeenCalled();
      }
    });

    it('should send Ichimoku alerts', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.lastIchimoku = {
          tenkan: 1.1,
          kijun: 1.0,
          senkouA: 1.05,
          senkouB: 0.95,
          chikou: 1.2,
          cloudTop: 1.05,
          cloudBottom: 0.95,
          cloudThickness: 0.1,
          isBullish: true,
          isBearish: false,
          inCloud: false,
        };

        const sendIchimokuAlert = (monitor as any)['sendIchimokuAlert'].bind(monitor);
        await sendIchimokuAlert(ca, 'Bullish signal detected', 1.5);

        expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
        expect(mockFormatIchimokuData).toHaveBeenCalled();
      }
    });

    it('should prevent duplicate alerts', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.alertsSent.add('test_alert');

        const sendAlert = (monitor as any)['sendAlert'].bind(monitor);
        await sendAlert(ca, 'Test alert message');

        // Should not send duplicate alert
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

      expect(monitor['hasAuthError']).toBe(true);
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
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0
      };

      await monitor.addCATracking(caData);

      mockAxios.get.mockResolvedValue({
        data: [{ price: 1.5 }]
      });

      const pollAlerts = (monitor as any)['pollIchimokuAlerts'].bind(monitor);
      await pollAlerts();

      expect(mockAxios.get).toHaveBeenCalled();
    });
  });

  /**
   * Tests for cleanup and shutdown procedures (ensures no intervals/sockets left open).
   */
  describe('Cleanup and Shutdown', () => {
    it('should stop monitoring', () => {
      monitor['ws'] = mockWebSocket;

      monitor.stop();

      expect(mockWebSocket.close).toHaveBeenCalled();
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
      const error = new Error('WebSocket error');
      mockWebSocket.on.mockImplementation((event: string | symbol, callback: Function) => {
        if (event === 'error') {
          callback.call(mockWebSocket, error);
        }
        return mockWebSocket;
      });

      await monitor.start();

      // Should not crash
      expect(monitor).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      mockDb.savePriceUpdate.mockRejectedValue(new Error('Database error'));

      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLoss: -0.2,
        entryPrice: 1.0
      };

      await monitor.addCATracking(caData);

      const priceUpdateMessage = {
        method: 'priceUpdate',
        params: {
          token: 'So11111111111111111111111111111111111111112',
          price: 1.5,
          timestamp: Date.now()
        }
      };

      const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
      
      // Should not throw
      await expect(handleMessage(priceUpdateMessage)).resolves.not.toThrow();
    });

    it('should handle API errors gracefully', async () => {
      mockAxios.get.mockRejectedValue(new Error('API error'));

      const pollAlerts = (monitor as any)['pollIchimokuAlerts'].bind(monitor);
      
      // Should not throw
      await expect(pollAlerts()).resolves.not.toThrow();
    });
  });
});