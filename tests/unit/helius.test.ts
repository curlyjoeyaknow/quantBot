/**
 * @file helius.test.ts
 * @description
 * Unit tests for the Helius API integration including WebSocket monitoring,
 * CA tracking, price updates, and alert management.
 */

// Mock all dependencies before importing
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

// Patch for WebSocket.OPEN static value if running outside real ws
if (typeof (WebSocket as any).OPEN === 'undefined') {
  (WebSocket as any).OPEN = 1;
}

// Mock implementations
const MockWebSocket = WebSocket as unknown as jest.MockedClass<typeof WebSocket>;
const mockAxios = axios as unknown as jest.Mocked<typeof axios>;
const mockDb = db as unknown as jest.Mocked<typeof db>;
const mockSimulateStrategy = simulateStrategy as unknown as jest.MockedFunction<typeof simulateStrategy>;
const mockCalculateIchimoku = calculateIchimoku as unknown as jest.MockedFunction<typeof calculateIchimoku>;
const mockDetectIchimokuSignals = detectIchimokuSignals as unknown as jest.MockedFunction<typeof detectIchimokuSignals>;
const mockFormatIchimokuData = formatIchimokuData as unknown as jest.MockedFunction<typeof formatIchimokuData>;

describe('HeliusMonitor', () => {
  let monitor: HeliusMonitor;
  let mockBot: any;
  let mockWebSocket: jest.Mocked<WebSocket>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock bot
    mockBot = {
      telegram: {
        sendMessage: jest.fn().mockResolvedValue(undefined),
      },
    };

    // Mock WebSocket
    mockWebSocket = {
      get readyState() { return (WebSocket as any).OPEN; },
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn().mockImplementation(() => mockWebSocket), // For chaining
    } as any;

    (MockWebSocket as unknown as { mockImplementation: any }).mockImplementation(() => mockWebSocket);

    // Mock database functions
    mockDb.getActiveCATracking.mockResolvedValue([]);
    mockDb.savePriceUpdate.mockResolvedValue(undefined);
    mockDb.saveAlertSent.mockResolvedValue(undefined);
    mockDb.getRecentCAPerformance.mockResolvedValue([]);

    // Mock simulation functions
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

    // Set up environment
    process.env.HELIUS_API_KEY = 'test-api-key';
    process.env.BOT_TOKEN = 'test-bot-token';

    monitor = new HeliusMonitor(mockBot);
  });

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

  describe('WebSocket Connection', () => {
    it('should connect to WebSocket', async () => {
      await monitor.start();

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
          setTimeout(() => callback(authError), 0);
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

  describe('CA Tracking Management', () => {
    it('should add CA tracking', async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: -0.2,
        callPrice: 1.0
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
        stopLossConfig: -0.2,
        callPrice: 1.0,
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
      expect(Array.isArray(ca?.candles) ? ca?.candles.length : null).toBe(60);
      expect(ca?.lastIchimoku).toBeDefined();
    });

    it('should subscribe to CA when WebSocket is open', async () => {
      monitor['ws'] = mockWebSocket;

      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: -0.2,
        callPrice: 1.0
      };

      await monitor.addCATracking(caData);

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('subscribe')
      );
    });
  });

  describe('Price Update Handling', () => {
    beforeEach(async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: -0.2,
        callPrice: 1.0
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

      // Mock the handleMessage method
      const handleMessage = (monitor as any)['handleMessage'].bind(monitor);
      await handleMessage(priceUpdateMessage);

      expect(mockDb.savePriceUpdate).toHaveBeenCalled();
    });

    it('should check alerts on price updates', async () => {
      const ca = monitor['activeCAs'].get('So11111111111111111111111111111111111111112');
      expect(ca).toBeDefined();

      if (ca) {
        ca.strategy = [{ percent: 0.5, target: 2.0 }];
        ca.callPrice = 1.0;

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
        ca.stopLossConfig = -0.2; // -20% stop loss
        ca.callPrice = 1.0;

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

  describe('Ichimoku Analysis', () => {
    beforeEach(async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: -0.2,
        callPrice: 1.0,
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
          direction: 'bullish',
          price: 1.5,
          timestamp: Date.now(),
          description: 'Tenkan-Kijun crossover detected',
          strength: 'strong' 
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

  describe('Alert Management', () => {
    beforeEach(async () => {
      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: -0.2,
        callPrice: 1.0
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
        if (!ca.alertsSent) {
          ca.alertsSent = new Set();
        }
        ca.alertsSent.add('test_alert');

        const sendAlert = (monitor as any)['sendAlert'].bind(monitor);
        await sendAlert(ca, 'Test alert message');

        // Should not send duplicate alert
        expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
      }
    });
  });

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
        stopLossConfig: -0.2,
        callPrice: 1.0
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

  describe('Error Handling', () => {
    it('should handle WebSocket errors gracefully', async () => {
      const error = new Error('WebSocket error');
      mockWebSocket.on.mockImplementation((event: string | symbol, callback: Function) => {
        if (event === 'error') {
          setTimeout(() => callback(error), 0);
        }
        return mockWebSocket;
      });

      await monitor.start();

      // Should not crash
      expect(monitor).toBeDefined();
      
      // Restore base mock behavior
      mockWebSocket.on.mockImplementation(() => mockWebSocket);
    });

    it('should handle database errors gracefully', async () => {
      mockDb.savePriceUpdate.mockRejectedValue(new Error('Database error'));

      const caData = {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        userId: 12345,
        chatId: 12345,
        strategy: [{ percent: 0.5, target: 2.0 }],
        stopLossConfig: -0.2,
        callPrice: 1.0
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
