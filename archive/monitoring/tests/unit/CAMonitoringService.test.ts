import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CAMonitoringService } from '../../src/CAMonitoringService';
import { createTokenAddress } from '@quantbot/core';
import type { Telegraf } from 'telegraf';

vi.mock('@quantbot/utils', () => ({
  getActiveCATracking: vi.fn().mockResolvedValue([]),
  savePriceUpdate: vi.fn().mockResolvedValue(undefined),
  saveAlertSent: vi.fn().mockResolvedValue(undefined),
  getRecentCAPerformance: vi.fn().mockResolvedValue([]),
  eventBus: {
    publish: vi.fn(),
  },
  EventFactory: {
    createSystemEvent: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@quantbot/simulation', () => ({
  calculateIchimoku: vi.fn(),
  detectIchimokuSignals: vi.fn(),
  formatIchimokuData: vi.fn(),
}));

describe('CAMonitoringService', () => {
  let service: CAMonitoringService;
  let mockBot: Telegraf;

  beforeEach(() => {
    mockBot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Telegraf;
    service = new CAMonitoringService(mockBot);
  });

  describe('initialize', () => {
    it('should initialize and load active CAs', async () => {
      await service.initialize();
      expect(service.getActiveCAs().size).toBe(0);
    });
  });

  describe('addCAMonitor', () => {
    it('should add a CA monitor and preserve mint address case', () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
      const ca = {
        id: 1,
        mint: fullMint,
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        strategy: [],
        stopLossConfig: { type: 'fixed', value: 0.1 },
        chatId: 123,
        userId: 1,
        alertsSent: new Set(),
        candles: [],
        ichimokuSignalsSent: new Set(),
      };

      service.addCAMonitor(ca);

      const activeCAs = service.getActiveCAs();
      expect(activeCAs.size).toBe(1);
      const stored = activeCAs.get('solana:7pXs123456789012345678901234567890pump');
      expect(stored?.mint).toBe(fullMint); // Case preserved
    });
  });

  describe('removeCAMonitor', () => {
    it('should remove a CA monitor', () => {
      const ca = {
        id: 1,
        mint: '7pXs123456789012345678901234567890pump',
        chain: 'solana',
        tokenName: 'Test',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        strategy: [],
        stopLossConfig: { type: 'fixed', value: 0.1 },
        chatId: 123,
        userId: 1,
        alertsSent: new Set(),
        candles: [],
        ichimokuSignalsSent: new Set(),
      };

      service.addCAMonitor(ca);
      expect(service.getActiveCAs().size).toBe(1);

      service.removeCAMonitor('solana', '7pXs123456789012345678901234567890pump');
      expect(service.getActiveCAs().size).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should clear all active monitors', () => {
      const ca = {
        id: 1,
        mint: '7pXs123456789012345678901234567890pump',
        chain: 'solana',
        tokenName: 'Test',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: Date.now(),
        strategy: [],
        stopLossConfig: { type: 'fixed', value: 0.1 },
        chatId: 123,
        userId: 1,
        alertsSent: new Set(),
        candles: [],
        ichimokuSignalsSent: new Set(),
      };

      service.addCAMonitor(ca);
      expect(service.getActiveCAs().size).toBe(1);

      service.shutdown();
      expect(service.getActiveCAs().size).toBe(0);
    });
  });
});

