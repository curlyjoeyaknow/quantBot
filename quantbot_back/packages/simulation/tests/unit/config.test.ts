import { describe, it, expect } from 'vitest';
import {
  StrategyLegSchema,
  StopLossConfigSchema,
  EntryConfigSchema,
  ReEntryConfigSchema,
} from '../../src/config';

describe('Config Schemas', () => {
  describe('StrategyLegSchema', () => {
    it('should validate valid strategy leg', () => {
      const result = StrategyLegSchema.safeParse({ target: 2.0, percent: 0.5 });
      expect(result.success).toBe(true);
    });

    it('should reject invalid strategy leg', () => {
      const result = StrategyLegSchema.safeParse({ target: -1, percent: 0.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('StopLossConfigSchema', () => {
    it('should validate valid stop loss config', () => {
      const result = StopLossConfigSchema.safeParse({ initial: -0.3, trailing: 0.5 });
      expect(result.success).toBe(true);
    });

    it('should validate stop loss with none trailing', () => {
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
  });
});
