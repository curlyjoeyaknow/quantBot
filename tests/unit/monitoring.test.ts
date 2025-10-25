/**
 * CA Monitoring Service Tests
 * ==========================
 * Tests for the CA monitoring service functionality
 */

import { CAMonitoringService, CAMonitor, PriceUpdateEvent } from '../../src/monitoring/CAMonitoringService';

// Mock database functions
jest.mock('../../src/utils/database', () => ({
  getActiveCATracking: jest.fn(),
  savePriceUpdate: jest.fn(),
  saveAlertSent: jest.fn(),
  getRecentCAPerformance: jest.fn(),
}));

// Mock Ichimoku functions
jest.mock('../../src/simulation/ichimoku', () => ({
  calculateIchimoku: jest.fn(),
  detectIchimokuSignals: jest.fn(),
  formatIchimokuData: jest.fn(),
}));

describe('CAMonitoringService', () => {
  let monitoringService: CAMonitoringService;
  let mockBot: any;

  beforeEach(() => {
    mockBot = {
      telegram: {
        sendMessage: jest.fn()
      }
    };
    monitoringService = new CAMonitoringService(mockBot);
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(monitoringService.initialize()).resolves.not.toThrow();
    });
  });

  describe('CA Management', () => {
    const mockCA: CAMonitor = {
      id: 1,
      mint: 'test-mint',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      callPrice: 0.001,
      callMarketcap: 1000000,
      callTimestamp: Date.now(),
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.2, trailing: 0.1 },
      chatId: 123456,
      userId: 789,
      alertsSent: new Set(),
      candles: [],
      ichimokuSignalsSent: new Set()
    };

    it('should add CA monitor', () => {
      const addSpy = jest.fn();
      monitoringService.on('caAdded', addSpy);
      
      monitoringService.addCAMonitor(mockCA);
      
      expect(addSpy).toHaveBeenCalledWith(mockCA);
      expect(monitoringService.getActiveCAs().size).toBe(1);
    });

    it('should remove CA monitor', () => {
      const removeSpy = jest.fn();
      monitoringService.on('caRemoved', removeSpy);
      
      monitoringService.addCAMonitor(mockCA);
      monitoringService.removeCAMonitor(mockCA.chain, mockCA.mint);
      
      expect(removeSpy).toHaveBeenCalledWith(mockCA);
      expect(monitoringService.getActiveCAs().size).toBe(0);
    });

    it('should get CA monitor by key', () => {
      monitoringService.addCAMonitor(mockCA);
      
      const retrieved = monitoringService.getCAMonitor(mockCA.chain, mockCA.mint);
      expect(retrieved).toEqual(mockCA);
    });
  });

  describe('Price Update Handling', () => {
    const mockCA: CAMonitor = {
      id: 1,
      mint: 'test-mint',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      callPrice: 0.001,
      callMarketcap: 1000000,
      callTimestamp: Date.now(),
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.2, trailing: 0.1 },
      chatId: 123456,
      userId: 789,
      alertsSent: new Set(),
      candles: [],
      ichimokuSignalsSent: new Set()
    };

    it('should handle price update', async () => {
      monitoringService.addCAMonitor(mockCA);
      
      const priceUpdate: PriceUpdateEvent = {
        account: 'test-mint',
        price: 0.002,
        marketcap: 2000000,
        timestamp: Date.now()
      };

      const priceUpdatedSpy = jest.fn();
      monitoringService.on('priceUpdated', priceUpdatedSpy);
      
      await monitoringService.handlePriceUpdate(priceUpdate);
      
      expect(priceUpdatedSpy).toHaveBeenCalled();
    });

    it('should ignore price update for unknown CA', async () => {
      const priceUpdate: PriceUpdateEvent = {
        account: 'unknown-mint',
        price: 0.002,
        marketcap: 2000000,
        timestamp: Date.now()
      };

      await expect(monitoringService.handlePriceUpdate(priceUpdate)).resolves.not.toThrow();
    });
  });

  describe('Subscription Management', () => {
    const mockCA: CAMonitor = {
      id: 1,
      mint: 'test-mint',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      callPrice: 0.001,
      callMarketcap: 1000000,
      callTimestamp: Date.now(),
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.2, trailing: 0.1 },
      chatId: 123456,
      userId: 789,
      alertsSent: new Set(),
      candles: [],
      ichimokuSignalsSent: new Set()
    };

    it('should generate subscription requests', () => {
      monitoringService.addCAMonitor(mockCA);
      
      const subscriptions = monitoringService.getSubscriptionRequests();
      
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0]).toHaveProperty('method', 'subscribe');
      expect(subscriptions[0]).toHaveProperty('params');
    });
  });

  describe('Performance Summary', () => {
    it('should generate performance summary', async () => {
      const summary = await monitoringService.getPerformanceSummary();
      
      expect(summary).toContain('Performance Summary');
    });

    it('should generate summary with active CAs', async () => {
      const mockCA: CAMonitor = {
        id: 1,
        mint: 'test-mint',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 0.001,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.1 },
        chatId: 123456,
        userId: 789,
        alertsSent: new Set(),
        candles: [],
        ichimokuSignalsSent: new Set(),
        lastPrice: 0.002
      };

      monitoringService.addCAMonitor(mockCA);
      
      const summary = await monitoringService.getPerformanceSummary();
      
      expect(summary).toContain('Test Token');
      expect(summary).toContain('TEST');
    });
  });
});
