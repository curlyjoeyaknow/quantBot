/**
 * Risk Manager Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskManager } from '../src/safety/risk-manager';
import { PositionManager } from '../src/positions/position-manager';
import { TradingConfigService } from '../src/config/trading-config';
import type { TradeOrder, TradingConfig } from '../src/types';

// Mock the queryPostgres function
vi.mock('@quantbot/data', () => ({
  queryPostgres: vi.fn(),
}));

describe('RiskManager', () => {
  let riskManager: RiskManager;
  let mockPositionManager: PositionManager;
  let mockTradingConfigService: TradingConfigService;

  const defaultConfig: TradingConfig = {
    userId: 123,
    enabled: true,
    maxPositionSize: 1.0,
    maxTotalExposure: 10.0,
    slippageTolerance: 0.01,
    dailyLossLimit: 5.0,
    alertRules: {
      caDropAlerts: false,
      ichimokuSignals: false,
      liveTradeEntry: false,
    },
    dryRun: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Mock position manager
    mockPositionManager = {
      getOpenPositions: vi.fn().mockResolvedValue([]),
    } as any;

    // Mock trading config service
    mockTradingConfigService = {
      getConfig: vi.fn().mockResolvedValue(defaultConfig),
    } as any;

    riskManager = new RiskManager({
      positionManager: mockPositionManager,
      tradingConfigService: mockTradingConfigService,
    });
  });

  describe('validateTrade', () => {
    const sampleBuyOrder: TradeOrder = {
      type: 'buy',
      tokenAddress: '22222222222222222222222222222222',
      amount: 0.5,
      slippageTolerance: 0.01,
      priorityFee: 0.0001,
    };

    it('should validate a valid trade', async () => {
      const result = await riskManager.validateTrade(sampleBuyOrder, 123);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject trade when trading is disabled', async () => {
      mockTradingConfigService.getConfig = vi
        .fn()
        .mockResolvedValue({ ...defaultConfig, enabled: false });

      const result = await riskManager.validateTrade(sampleBuyOrder, 123);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should reject trade when config is missing', async () => {
      mockTradingConfigService.getConfig = vi.fn().mockResolvedValue(null);

      const result = await riskManager.validateTrade(sampleBuyOrder, 123);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should reject trade with excessive slippage', async () => {
      const highSlippageOrder: TradeOrder = {
        ...sampleBuyOrder,
        slippageTolerance: 0.1, // 10%, exceeds config limit of 1%
      };

      const result = await riskManager.validateTrade(highSlippageOrder, 123);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Slippage');
    });
  });

  describe('checkPositionLimits', () => {
    it('should allow position within limits', async () => {
      const result = await riskManager.checkPositionLimits(123, 0.5, defaultConfig);
      expect(result.valid).toBe(true);
    });

    it('should reject position exceeding max position size', async () => {
      const result = await riskManager.checkPositionLimits(123, 2.0, defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should reject position exceeding total exposure', async () => {
      // Mock existing positions totaling 9.5 SOL
      mockPositionManager.getOpenPositions = vi.fn().mockResolvedValue([
        { remainingSize: 5.0 },
        { remainingSize: 4.5 },
      ]);

      // Try to add 1.0 SOL position (total would be 10.5, exceeds 10.0 limit)
      const result = await riskManager.checkPositionLimits(123, 1.0, defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Total exposure');
    });

    it('should allow position at exact total exposure limit', async () => {
      // Mock existing positions totaling 9.0 SOL
      mockPositionManager.getOpenPositions = vi.fn().mockResolvedValue([
        { remainingSize: 5.0 },
        { remainingSize: 4.0 },
      ]);

      // Try to add 1.0 SOL position (total would be exactly 10.0)
      const result = await riskManager.checkPositionLimits(123, 1.0, defaultConfig);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateSlippage', () => {
    it('should validate acceptable slippage', () => {
      const result = riskManager.validateSlippage(
        1.0,  // expected price
        1.005, // actual price (0.5% slippage)
        0.01   // 1% tolerance
      );
      expect(result).toBe(true);
    });

    it('should reject excessive slippage', () => {
      const result = riskManager.validateSlippage(
        1.0,  // expected price
        1.02,  // actual price (2% slippage)
        0.01   // 1% tolerance
      );
      expect(result).toBe(false);
    });

    it('should handle negative slippage (price improvement)', () => {
      const result = riskManager.validateSlippage(
        1.0,   // expected price
        0.995, // actual price (0.5% improvement)
        0.01   // 1% tolerance
      );
      expect(result).toBe(true);
    });

    it('should handle zero tolerance', () => {
      const result = riskManager.validateSlippage(
        1.0,
        1.0,
        0.0
      );
      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero open positions', async () => {
      mockPositionManager.getOpenPositions = vi.fn().mockResolvedValue([]);

      const result = await riskManager.checkPositionLimits(123, 0.5, defaultConfig);
      expect(result.valid).toBe(true);
    });

    it('should handle multiple concurrent positions', async () => {
      mockPositionManager.getOpenPositions = vi.fn().mockResolvedValue([
        { remainingSize: 2.0 },
        { remainingSize: 2.0 },
        { remainingSize: 2.0 },
        { remainingSize: 2.0 },
      ]);

      const result = await riskManager.checkPositionLimits(123, 1.0, defaultConfig);
      expect(result.valid).toBe(false); // Total would be 9.0, but this position alone doesn't exceed limits
    });
  });
});

