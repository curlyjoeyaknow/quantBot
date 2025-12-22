/**
 * Slippage Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSlippage,
  calculateEntrySlippage,
  calculateExitSlippage,
  createPumpfunSlippageConfig,
} from '../../src/execution-models/slippage.js';
import type { SlippageModel } from '../../src/execution-models/types.js';

describe('Slippage Models', () => {
  describe('calculateSlippage', () => {
    it('should calculate fixed slippage', () => {
      const model: SlippageModel = {
        type: 'fixed',
        fixedBps: 50,
        minBps: 0,
        maxBps: 1000,
      };

      const slippage = calculateSlippage(model, 100, 0, 1);
      expect(slippage).toBe(50);
    });

    it('should calculate linear slippage', () => {
      const model: SlippageModel = {
        type: 'linear',
        linearCoefficient: 10,
        minBps: 0,
        maxBps: 1000,
      };

      const slippage = calculateSlippage(model, 5, 0, 1);
      expect(slippage).toBe(50); // 10 * 5
    });

    it('should calculate sqrt slippage', () => {
      const model: SlippageModel = {
        type: 'sqrt',
        sqrtCoefficient: 50,
        minBps: 0,
        maxBps: 1000,
      };

      const slippage = calculateSlippage(model, 4, 0, 1);
      expect(slippage).toBe(100); // 50 * sqrt(4) = 50 * 2
    });

    it('should respect min/max bounds', () => {
      const model: SlippageModel = {
        type: 'fixed',
        fixedBps: 5000, // Above max
        minBps: 10,
        maxBps: 100,
      };

      const slippage = calculateSlippage(model, 100, 0, 1);
      expect(slippage).toBe(100); // Clamped to max
    });

    it('should apply volatility multiplier', () => {
      const model: SlippageModel = {
        type: 'fixed',
        fixedBps: 50,
        minBps: 0,
        maxBps: 1000,
      };

      const slippage = calculateSlippage(model, 100, 0, 2.0); // 2x volatility
      expect(slippage).toBe(100); // 50 * 2
    });
  });

  describe('calculateEntrySlippage', () => {
    it('should calculate entry slippage with volatility', () => {
      const config = createPumpfunSlippageConfig();
      const slippage = calculateEntrySlippage(config, 100, 0, 0.5);

      expect(slippage).toBeGreaterThanOrEqual(config.entrySlippage.minBps);
      expect(slippage).toBeLessThanOrEqual(config.entrySlippage.maxBps);
    });
  });

  describe('calculateExitSlippage', () => {
    it('should calculate exit slippage', () => {
      const config = createPumpfunSlippageConfig();
      const slippage = calculateExitSlippage(config, 100, 0, 0);

      expect(slippage).toBeGreaterThanOrEqual(config.exitSlippage.minBps);
      expect(slippage).toBeLessThanOrEqual(config.exitSlippage.maxBps);
    });
  });
});
