import { describe, it, expect } from 'vitest';
import {
  buildStrategy,
  buildStopLossConfig,
  buildEntryConfig,
  buildReEntryConfig,
  buildFromPreset,
  validateStrategy,
} from '../../src/simulation/strategies/builder';
import type { StrategyConfig } from '../../src/simulation/strategies/types';

describe('strategy-builder-extended', () => {
  describe('buildStrategy', () => {
    it('should build strategy from config', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [
          { target: 2, percent: 0.5 },
          { target: 3, percent: 0.5 },
        ],
      };

      const strategy = buildStrategy(config);

      expect(strategy).toHaveLength(2);
      expect(strategy[0].target).toBe(2);
      expect(strategy[0].percent).toBe(0.5);
    });

    it('should handle empty profit targets', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [],
      };

      const strategy = buildStrategy(config);

      expect(strategy).toHaveLength(0);
    });
  });

  describe('buildStopLossConfig', () => {
    it('should build stop loss config', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.2,
          trailing: 2.0,
          trailingPercent: 0.1,
        },
      };

      const stopLoss = buildStopLossConfig(config);

      expect(stopLoss?.initial).toBe(-0.2);
      expect(stopLoss?.trailing).toBe(2.0);
    });

    it('should return undefined when no stop loss', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const stopLoss = buildStopLossConfig(config);

      expect(stopLoss).toBeUndefined();
    });

    it('should use none for trailing when not provided', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.2,
        },
      };

      const stopLoss = buildStopLossConfig(config);

      expect(stopLoss?.trailing).toBe('none');
    });
  });

  describe('buildEntryConfig', () => {
    it('should build entry config', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {
          initialEntry: -0.1,
          trailingEntry: 0.05,
          maxWaitTime: 60,
        },
      };

      const entry = buildEntryConfig(config);

      expect(entry?.initialEntry).toBe(-0.1);
      expect(entry?.trailingEntry).toBe(0.05);
      expect(entry?.maxWaitTime).toBe(60);
    });

    it('should return undefined when no entry config', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const entry = buildEntryConfig(config);

      expect(entry).toBeUndefined();
    });

    it('should use defaults when not provided', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {},
      };

      const entry = buildEntryConfig(config);

      expect(entry?.initialEntry).toBe('none');
      expect(entry?.trailingEntry).toBe('none');
      expect(entry?.maxWaitTime).toBe(60);
    });
  });

  describe('buildReEntryConfig', () => {
    it('should build re-entry config', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        reEntry: {
          trailingReEntry: 0.1,
          maxReEntries: 3,
          sizePercent: 0.5,
        },
      };

      const reEntry = buildReEntryConfig(config);

      expect(reEntry?.trailingReEntry).toBe(0.1);
      expect(reEntry?.maxReEntries).toBe(3);
      expect(reEntry?.sizePercent).toBe(0.5);
    });

    it('should return undefined when no re-entry config', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      const reEntry = buildReEntryConfig(config);

      expect(reEntry).toBeUndefined();
    });

    it('should use defaults when not provided', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        reEntry: {},
      };

      const reEntry = buildReEntryConfig(config);

      expect(reEntry?.trailingReEntry).toBe('none');
      expect(reEntry?.maxReEntries).toBe(0);
      expect(reEntry?.sizePercent).toBe(0.5);
    });
  });

  describe('buildFromPreset', () => {
    it('should build from preset name', () => {
      const config = buildFromPreset('basic-6h-20pct-sl');

      expect(config).toBeDefined();
      expect(config?.name).toBeDefined();
    });

    it('should return null for invalid preset', () => {
      const config = buildFromPreset('invalid-preset' as any);

      expect(config).toBeNull();
    });
  });

  describe('validateStrategy', () => {
    it('should validate correct strategy', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
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
        name: 'Test',
        profitTargets: [],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('At least one profit target is required');
    });

    it('should reject strategy with total percent > 1', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [
          { target: 2, percent: 0.6 },
          { target: 3, percent: 0.5 },
        ],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds 1.0'))).toBe(true);
    });

    it('should reject invalid profit target multiplier', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: -1, percent: 1.0 }],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('multiplier must be positive'))).toBe(true);
    });

    it('should reject invalid profit target percent', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.5 }],
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('between 0 and 1'))).toBe(true);
    });

    it('should reject positive stop loss initial', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: 0.2,
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('should be negative'))).toBe(true);
    });

    it('should reject invalid trailing stop percent', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.2,
          trailing: 2.0,
          trailingPercent: 1.5,
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Trailing stop percent'))).toBe(true);
    });

    it('should reject positive initial entry', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {
          initialEntry: 0.1,
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Initial entry drop should be negative'))).toBe(true);
    });

    it('should reject negative trailing entry', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        entry: {
          trailingEntry: -0.1,
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Trailing entry rebound should be positive'))).toBe(true);
    });

    it('should reject invalid re-entry percent', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        reEntry: {
          trailingReEntry: 1.5,
        },
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Trailing re-entry percent'))).toBe(true);
    });

    it('should reject negative hold hours', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        holdHours: -1,
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Hold hours must be non-negative'))).toBe(true);
    });

    it('should reject invalid loss clamp percent', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        lossClampPercent: 1.5,
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Loss clamp percent'))).toBe(true);
    });

    it('should reject invalid min exit price', () => {
      const config: StrategyConfig = {
        name: 'Test',
        profitTargets: [{ target: 2, percent: 1.0 }],
        minExitPrice: 1.5,
      };

      const result = validateStrategy(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Min exit price'))).toBe(true);
    });
  });
});


