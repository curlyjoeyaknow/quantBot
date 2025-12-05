import { describe, it, expect, vi } from 'vitest';
import {
  buildStrategy,
  buildStopLossConfig,
  buildEntryConfig,
  buildReEntryConfig,
  buildFromPreset,
  validateStrategy,
} from '../../src/simulation/strategies/builder';
import type { StrategyConfig } from '../../src/simulation/strategies/types';

// Mock presets
vi.mock('../../src/simulation/strategies/presets', () => ({
  getPreset: vi.fn((name: string) => {
    if (name === 'conservative') {
      return {
        name: 'Conservative',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };
    }
    return null;
  }),
}));

describe('strategy-builder', () => {
  describe('buildStrategy', () => {
    it('should convert profit targets to Strategy array', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [
          { target: 2, percent: 0.5 },
          { target: 5, percent: 0.3 },
          { target: 10, percent: 0.2 },
        ],
      };

      const result = buildStrategy(config);

      expect(result).toEqual([
        { target: 2, percent: 0.5 },
        { target: 5, percent: 0.3 },
        { target: 10, percent: 0.2 },
      ]);
    });

    it('should handle single profit target', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const result = buildStrategy(config);

      expect(result).toEqual([{ target: 2, percent: 1.0 }]);
    });
  });

  describe('buildStopLossConfig', () => {
    it('should convert stop loss config', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.3,
          trailing: 0.1,
        },
      };

      const result = buildStopLossConfig(config);

      expect(result).toEqual({
        initial: -0.3,
        trailing: 0.1,
      });
    });

    it('should return undefined when stop loss is not configured', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const result = buildStopLossConfig(config);

      expect(result).toBeUndefined();
    });

    it('should default trailing to none', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.3,
        },
      };

      const result = buildStopLossConfig(config);

      expect(result).toEqual({
        initial: -0.3,
        trailing: 'none',
      });
    });
  });

  describe('buildEntryConfig', () => {
    it('should convert entry config', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {
          initialEntry: -0.1,
          trailingEntry: 0.05,
          maxWaitTime: 120,
        },
      };

      const result = buildEntryConfig(config);

      expect(result).toEqual({
        initialEntry: -0.1,
        trailingEntry: 0.05,
        maxWaitTime: 120,
      });
    });

    it('should return undefined when entry is not configured', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const result = buildEntryConfig(config);

      expect(result).toBeUndefined();
    });

    it('should default values', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {},
      };

      const result = buildEntryConfig(config);

      expect(result).toEqual({
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60,
      });
    });
  });

  describe('buildReEntryConfig', () => {
    it('should convert re-entry config', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        reEntry: {
          trailingReEntry: 0.1,
          maxReEntries: 3,
          sizePercent: 0.5,
        },
      };

      const result = buildReEntryConfig(config);

      expect(result).toEqual({
        trailingReEntry: 0.1,
        maxReEntries: 3,
        sizePercent: 0.5,
      });
    });

    it('should return undefined when re-entry is not configured', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const result = buildReEntryConfig(config);

      expect(result).toBeUndefined();
    });

    it('should default values', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        reEntry: {},
      };

      const result = buildReEntryConfig(config);

      expect(result).toEqual({
        trailingReEntry: 'none',
        maxReEntries: 0,
        sizePercent: 0.5,
      });
    });
  });

  describe('buildFromPreset', () => {
    it('should build strategy from preset name', () => {
      const result = buildFromPreset('conservative');

      expect(result).toEqual({
        name: 'Conservative',
        profitTargets: [{ target: 2, percent: 1.0 }],
      });
    });

    it('should return null for unknown preset', () => {
      const result = buildFromPreset('unknown' as any);

      expect(result).toBeNull();
    });
  });

  describe('validateStrategy', () => {
    it('should validate a correct strategy', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [
          { target: 2, percent: 0.5 },
          { target: 5, percent: 0.5 },
        ],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject strategy without name', () => {
      const config: StrategyConfig = {
        name: '',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Strategy name is required');
    });

    it('should reject strategy without profit targets', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('At least one profit target is required');
    });

    it('should reject strategy with total percent > 1.0', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [
          { target: 2, percent: 0.6 },
          { target: 5, percent: 0.5 },
        ],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Total profit target percent (1.1) exceeds 1.0');
    });

    it('should reject negative profit target percent', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: -0.1 }],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('cannot be negative'))).toBe(true);
    });

    it('should reject invalid profit target multiplier', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 0, percent: 1.0 }],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('multiplier must be positive'))).toBe(true);
    });

    it('should reject profit target percent > 1', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.5 }],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('must be between 0 and 1'))).toBe(true);
    });

    it('should validate stop loss config', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: 0.3, // Should be negative
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Stop loss initial should be negative'))).toBe(
        true,
      );
    });

    it('should validate trailing stop percent', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.3,
          trailing: 0.1,
          trailingPercent: 1.5, // Should be < 1
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Trailing stop percent should be between 0 and 1'))).toBe(
        true,
      );
    });

    it('should validate entry config', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {
          initialEntry: 0.1, // Should be negative
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Initial entry drop should be negative'))).toBe(
        true,
      );
    });

    it('should validate re-entry config', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        reEntry: {
          trailingReEntry: 1.5, // Should be < 1
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Trailing re-entry percent should be between 0 and 1'))).toBe(
        true,
      );
    });

    it('should validate hold hours', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        holdHours: -1,
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hold hours must be non-negative');
    });

    it('should validate loss clamp percent', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        lossClampPercent: 1.5,
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Loss clamp percent should be between 0 and 1'))).toBe(
        true,
      );
    });

    it('should validate min exit price', () => {
      const config: StrategyConfig = {
        name: 'test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        minExitPrice: 1.5,
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Min exit price should be between 0 and 1'))).toBe(
        true,
      );
    });
  });
});

