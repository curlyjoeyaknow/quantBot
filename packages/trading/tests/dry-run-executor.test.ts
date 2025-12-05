/**
 * Dry Run Executor Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DryRunExecutor } from '../src/safety/dry-run-executor';
import { TradeExecutor } from '../src/execution/trade-executor';
import type { TradeOrder } from '../src/types';

// Mock dependencies
vi.mock('../src/execution/trade-executor');

describe('DryRunExecutor', () => {
  let dryRunExecutor: DryRunExecutor;
  let mockTradeExecutor: TradeExecutor;

  beforeEach(() => {
    mockTradeExecutor = {
      buildBuyTransaction: vi.fn().mockResolvedValue({
        instructions: [],
        feePayer: null,
      }),
      buildSellTransaction: vi.fn().mockResolvedValue({
        instructions: [],
        feePayer: null,
      }),
    } as any;

    dryRunExecutor = new DryRunExecutor({
      tradeExecutor: mockTradeExecutor,
    });
  });

  describe('executeTrade', () => {
    const sampleBuyOrder: TradeOrder = {
      type: 'buy',
      tokenAddress: '22222222222222222222222222222222',
      amount: 0.5,
      slippageTolerance: 0.01,
      priorityFee: 0.0001,
    };

    const sampleSellOrder: TradeOrder = {
      type: 'sell',
      tokenAddress: '22222222222222222222222222222222',
      amount: 1000000,
      slippageTolerance: 0.01,
      priorityFee: 0.0001,
    };

    it('should simulate buy trade without execution', async () => {
      const result = await dryRunExecutor.executeTrade(sampleBuyOrder, 123);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.signature).toBeUndefined();
      expect(result.message).toContain('DRY RUN');
    });

    it('should simulate sell trade without execution', async () => {
      const result = await dryRunExecutor.executeTrade(sampleSellOrder, 123);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.signature).toBeUndefined();
      expect(result.message).toContain('DRY RUN');
    });

    it('should log trade details', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dryRunExecutor.executeTrade(sampleBuyOrder, 123);

      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('should build transaction but not send it', async () => {
      await dryRunExecutor.executeTrade(sampleBuyOrder, 123);

      // Transaction should be built for validation
      expect(mockTradeExecutor.buildBuyTransaction).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockTradeExecutor.buildBuyTransaction = vi.fn().mockRejectedValue(
        new Error('Build failed')
      );

      const result = await dryRunExecutor.executeTrade(sampleBuyOrder, 123);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Build failed');
    });
  });

  describe('logging', () => {
    it('should log comprehensive trade information', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const order: TradeOrder = {
        type: 'buy',
        tokenAddress: '22222222222222222222222222222222',
        amount: 0.5,
        slippageTolerance: 0.01,
        priorityFee: 0.0001,
        stopLoss: 0.1,
        takeProfit: 0.2,
      };

      await dryRunExecutor.executeTrade(order, 123);

      const logCalls = logSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('buy');
      expect(logCalls).toContain('0.5');

      logSpy.mockRestore();
    });
  });

  describe('validation', () => {
    it('should validate transaction structure', async () => {
      const order: TradeOrder = {
        type: 'buy',
        tokenAddress: '22222222222222222222222222222222',
        amount: 0.5,
        slippageTolerance: 0.01,
        priorityFee: 0.0001,
      };

      const result = await dryRunExecutor.executeTrade(order, 123);

      expect(result.success).toBe(true);
      // Transaction should be validated during build
    });

    it('should detect invalid transactions', async () => {
      mockTradeExecutor.buildBuyTransaction = vi.fn().mockRejectedValue(
        new Error('Invalid transaction parameters')
      );

      const order: TradeOrder = {
        type: 'buy',
        tokenAddress: 'invalid',
        amount: -1,
        slippageTolerance: 0.01,
      };

      const result = await dryRunExecutor.executeTrade(order, 123);

      expect(result.success).toBe(false);
    });
  });
});

