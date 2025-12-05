/**
 * Strategy Executor Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrategyExecutor } from '../src/execution/strategy-executor';
import type { TradingConfig } from '../src/types';

describe('StrategyExecutor', () => {
  let executor: StrategyExecutor;

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
    executor = new StrategyExecutor();
  });

  describe('convertStrategyToOrder', () => {
    it('should convert buy signal to trade order', () => {
      const signal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Ichimoku bullish signal',
      };

      const order = executor.convertStrategyToOrder(signal, defaultConfig);

      expect(order.type).toBe('buy');
      expect(order.tokenAddress).toBe(signal.tokenAddress);
      expect(order.amount).toBeLessThanOrEqual(defaultConfig.maxPositionSize);
      expect(order.slippageTolerance).toBe(defaultConfig.slippageTolerance);
    });

    it('should convert sell signal to trade order', () => {
      const signal = {
        type: 'sell' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.7,
        reason: 'Stop loss triggered',
        amount: 1000000,
      };

      const order = executor.convertStrategyToOrder(signal, defaultConfig);

      expect(order.type).toBe('sell');
      expect(order.tokenAddress).toBe(signal.tokenAddress);
      expect(order.amount).toBe(1000000);
    });

    it('should calculate position size based on confidence', () => {
      const highConfidenceSignal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.9,
        reason: 'Strong signal',
      };

      const lowConfidenceSignal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.5,
        reason: 'Weak signal',
      };

      const highOrder = executor.convertStrategyToOrder(highConfidenceSignal, defaultConfig);
      const lowOrder = executor.convertStrategyToOrder(lowConfidenceSignal, defaultConfig);

      // Higher confidence should result in larger position size
      expect(highOrder.amount).toBeGreaterThan(lowOrder.amount);
    });

    it('should respect max position size', () => {
      const signal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 1.0, // Maximum confidence
        reason: 'Very strong signal',
      };

      const order = executor.convertStrategyToOrder(signal, defaultConfig);

      expect(order.amount).toBeLessThanOrEqual(defaultConfig.maxPositionSize);
    });

    it('should use configured slippage tolerance', () => {
      const signal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Test signal',
      };

      const order = executor.convertStrategyToOrder(signal, defaultConfig);

      expect(order.slippageTolerance).toBe(defaultConfig.slippageTolerance);
    });
  });

  describe('calculatePositionSize', () => {
    it('should scale with confidence', () => {
      const size1 = executor.calculatePositionSize(0.5, defaultConfig);
      const size2 = executor.calculatePositionSize(1.0, defaultConfig);

      expect(size2).toBeGreaterThan(size1);
      expect(size2).toBeLessThanOrEqual(defaultConfig.maxPositionSize);
    });

    it('should return minimum size for very low confidence', () => {
      const size = executor.calculatePositionSize(0.1, defaultConfig);

      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(defaultConfig.maxPositionSize);
    });

    it('should never exceed max position size', () => {
      const size = executor.calculatePositionSize(1.5, defaultConfig); // Over 100% confidence

      expect(size).toBeLessThanOrEqual(defaultConfig.maxPositionSize);
    });
  });

  describe('validateStrategy', () => {
    it('should validate correct buy strategy', () => {
      const strategy = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Valid signal',
      };

      expect(() => executor.validateStrategy(strategy)).not.toThrow();
    });

    it('should validate correct sell strategy', () => {
      const strategy = {
        type: 'sell' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Valid signal',
        amount: 1000000,
      };

      expect(() => executor.validateStrategy(strategy)).not.toThrow();
    });

    it('should reject strategy with invalid confidence', () => {
      const strategy = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: -0.5, // Invalid
        reason: 'Invalid confidence',
      };

      expect(() => executor.validateStrategy(strategy)).toThrow();
    });

    it('should reject sell strategy without amount', () => {
      const strategy = {
        type: 'sell' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Missing amount',
      };

      expect(() => executor.validateStrategy(strategy)).toThrow();
    });

    it('should reject strategy with invalid token address', () => {
      const strategy = {
        type: 'buy' as const,
        tokenAddress: 'invalid-address',
        confidence: 0.8,
        reason: 'Invalid address',
      };

      expect(() => executor.validateStrategy(strategy)).toThrow();
    });
  });

  describe('stop loss and take profit', () => {
    it('should attach stop loss config to order', () => {
      const signal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Test signal',
        stopLoss: 0.1, // 10% stop loss
      };

      const order = executor.convertStrategyToOrder(signal, defaultConfig);

      expect(order.stopLoss).toBe(0.1);
    });

    it('should attach take profit config to order', () => {
      const signal = {
        type: 'buy' as const,
        tokenAddress: '22222222222222222222222222222222',
        confidence: 0.8,
        reason: 'Test signal',
        takeProfit: 0.2, // 20% take profit
      };

      const order = executor.convertStrategyToOrder(signal, defaultConfig);

      expect(order.takeProfit).toBe(0.2);
    });
  });
});

