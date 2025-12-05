import { describe, it, expect } from 'vitest';
import {
  StrategyLegSchema,
  StopLossConfigSchema,
  EntryConfigSchema,
  ReEntryConfigSchema,
  LadderConfigSchema,
  SignalConditionSchema,
  SignalGroupSchema,
  CostConfigSchema,
} from '../../src/simulation/config';

describe('config-validation', () => {
  describe('StrategyLegSchema', () => {
    it('should validate valid strategy leg', () => {
      const result = StrategyLegSchema.safeParse({ target: 2, percent: 0.5 });
      expect(result.success).toBe(true);
    });

    it('should reject negative target', () => {
      const result = StrategyLegSchema.safeParse({ target: -1, percent: 0.5 });
      expect(result.success).toBe(false);
    });

    it('should reject percent > 1', () => {
      const result = StrategyLegSchema.safeParse({ target: 2, percent: 1.5 });
      expect(result.success).toBe(false);
    });

    it('should reject negative percent', () => {
      const result = StrategyLegSchema.safeParse({ target: 2, percent: -0.1 });
      expect(result.success).toBe(false);
    });
  });

  describe('StopLossConfigSchema', () => {
    it('should validate valid stop loss config', () => {
      const result = StopLossConfigSchema.safeParse({ initial: -0.3 });
      expect(result.success).toBe(true);
    });

    it('should reject positive initial stop loss', () => {
      const result = StopLossConfigSchema.safeParse({ initial: 0.3 });
      expect(result.success).toBe(false);
    });

    it('should accept trailing as number', () => {
      const result = StopLossConfigSchema.safeParse({ initial: -0.3, trailing: 0.1 });
      expect(result.success).toBe(true);
    });

    it('should accept trailing as none', () => {
      const result = StopLossConfigSchema.safeParse({ initial: -0.3, trailing: 'none' });
      expect(result.success).toBe(true);
    });
  });

  describe('EntryConfigSchema', () => {
    it('should validate valid entry config', () => {
      const result = EntryConfigSchema.safeParse({
        initialEntry: -0.1,
        trailingEntry: 0.05,
        maxWaitTime: 60,
      });
      expect(result.success).toBe(true);
    });

    it('should use defaults when not provided', () => {
      const result = EntryConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.initialEntry).toBe('none');
        expect(result.data.trailingEntry).toBe('none');
        expect(result.data.maxWaitTime).toBe(60);
      }
    });

    it('should reject positive initialEntry', () => {
      const result = EntryConfigSchema.safeParse({ initialEntry: 0.1 });
      expect(result.success).toBe(false);
    });
  });

  describe('ReEntryConfigSchema', () => {
    it('should validate valid re-entry config', () => {
      const result = ReEntryConfigSchema.safeParse({
        trailingReEntry: 0.1,
        maxReEntries: 3,
        sizePercent: 0.5,
      });
      expect(result.success).toBe(true);
    });

    it('should use defaults when not provided', () => {
      const result = ReEntryConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trailingReEntry).toBe('none');
        expect(result.data.maxReEntries).toBe(0);
        expect(result.data.sizePercent).toBe(0.5);
      }
    });

    it('should reject trailingReEntry >= 1', () => {
      const result = ReEntryConfigSchema.safeParse({ trailingReEntry: 1.0 });
      expect(result.success).toBe(false);
    });
  });

  describe('LadderConfigSchema', () => {
    it('should validate valid ladder config', () => {
      const result = LadderConfigSchema.safeParse({
        legs: [{ sizePercent: 0.5 }, { sizePercent: 0.5 }],
        sequential: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty legs array', () => {
      const result = LadderConfigSchema.safeParse({ legs: [] });
      expect(result.success).toBe(false);
    });

    it('should use default sequential value', () => {
      const result = LadderConfigSchema.safeParse({
        legs: [{ sizePercent: 1.0 }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sequential).toBe(true);
      }
    });
  });

  describe('SignalConditionSchema', () => {
    it('should validate valid signal condition', () => {
      const result = SignalConditionSchema.safeParse({
        indicator: 'sma',
        operator: '>',
        value: 1.0,
      });
      expect(result.success).toBe(true);
    });

    it('should validate cross condition', () => {
      const result = SignalConditionSchema.safeParse({
        indicator: 'sma',
        operator: 'crosses_above',
        secondaryIndicator: 'ema',
      });
      expect(result.success).toBe(true);
    });

    it('should use default field value', () => {
      const result = SignalConditionSchema.safeParse({
        indicator: 'sma',
        operator: '>',
        value: 1.0,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.field).toBe('value');
      }
    });
  });

  describe('SignalGroupSchema', () => {
    it('should validate valid signal group', () => {
      const result = SignalGroupSchema.safeParse({
        logic: 'AND',
        conditions: [
          { indicator: 'sma', operator: '>', value: 1.0 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should validate nested signal groups', () => {
      const result = SignalGroupSchema.safeParse({
        logic: 'OR',
        groups: [
          {
            logic: 'AND',
            conditions: [{ indicator: 'sma', operator: '>', value: 1.0 }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should use default logic value', () => {
      const result = SignalGroupSchema.safeParse({
        conditions: [{ indicator: 'sma', operator: '>', value: 1.0 }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.logic).toBe('AND');
      }
    });
  });

  describe('CostConfigSchema', () => {
    it('should validate valid cost config', () => {
      const result = CostConfigSchema.safeParse({
        entrySlippageBps: 10,
        exitSlippageBps: 20,
        takerFeeBps: 25,
        borrowAprBps: 100,
      });
      expect(result.success).toBe(true);
    });

    it('should use defaults when not provided', () => {
      const result = CostConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entrySlippageBps).toBe(0);
        expect(result.data.exitSlippageBps).toBe(0);
        expect(result.data.takerFeeBps).toBe(25);
        expect(result.data.borrowAprBps).toBe(0);
      }
    });

    it('should reject negative slippage', () => {
      const result = CostConfigSchema.safeParse({ entrySlippageBps: -1 });
      expect(result.success).toBe(false);
    });
  });
});

