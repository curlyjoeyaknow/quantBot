import { describe, it, expect } from 'vitest';
import { getPreset, registerPreset, listPresets } from '../src/strategies/presets';
import type { StrategyConfig, StrategyPresetName } from '../src/strategies/types';

describe('presets', () => {
  describe('getPreset', () => {
    it('should return preset for valid name', () => {
      const preset = getPreset('basic-6h-20pct-sl');

      expect(preset).toBeDefined();
      expect(preset?.name).toBe('Basic_6h_20pctSL');
      expect(preset?.stopLoss?.initial).toBe(-0.2);
      expect(preset?.holdHours).toBe(6);
    });

    it('should return conservative preset', () => {
      const preset = getPreset('conservative-24h');

      expect(preset).toBeDefined();
      expect(preset?.name).toBe('Conservative_24h');
      expect(preset?.profitTargets).toHaveLength(3);
      expect(preset?.holdHours).toBe(24);
    });

    it('should return aggressive preset', () => {
      const preset = getPreset('aggressive-multi-tp');

      expect(preset).toBeDefined();
      expect(preset?.name).toBe('Aggressive_MultiTP');
      expect(preset?.profitTargets).toHaveLength(3);
      expect(preset?.stopLoss?.initial).toBe(-0.4);
    });

    it('should return trailing stop preset', () => {
      const preset = getPreset('trailing-stop-20pct');

      expect(preset).toBeDefined();
      expect(preset?.name).toBe('Trailing_20pct');
      expect(preset?.stopLoss?.trailing).toBe(2.0);
      expect(preset?.stopLoss?.trailingPercent).toBe(0.2);
    });

    it('should return buy the dip preset', () => {
      const preset = getPreset('buy-the-dip-30pct');

      expect(preset).toBeDefined();
      expect(preset?.name).toBe('BuyTheDip_30pct');
      expect(preset?.entry?.initialEntry).toBe(-0.3);
      expect(preset?.entry?.maxWaitTime).toBe(60);
    });

    it('should return null for unknown preset', () => {
      const preset = getPreset('unknown-preset' as StrategyPresetName);

      expect(preset).toBeNull();
    });
  });

  describe('registerPreset', () => {
    it('should register a new preset', () => {
      const customConfig: StrategyConfig = {
        name: 'Custom Strategy',
        profitTargets: [{ target: 2, percent: 1.0 }],
      };

      registerPreset('custom-test' as StrategyPresetName, customConfig);

      const retrieved = getPreset('custom-test' as StrategyPresetName);
      expect(retrieved).toEqual(customConfig);
    });

    it('should overwrite existing preset', () => {
      const original = getPreset('basic-6h-20pct-sl');
      expect(original).toBeDefined();

      const newConfig: StrategyConfig = {
        name: 'Overwritten',
        profitTargets: [{ target: 3, percent: 1.0 }],
      };

      registerPreset('basic-6h-20pct-sl', newConfig);

      const updated = getPreset('basic-6h-20pct-sl');
      expect(updated).toEqual(newConfig);
      expect(updated?.name).toBe('Overwritten');
    });
  });

  describe('listPresets', () => {
    it('should return list of all preset names', () => {
      const presets = listPresets();

      expect(presets).toBeInstanceOf(Array);
      expect(presets.length).toBeGreaterThan(0);
      expect(presets).toContain('basic-6h-20pct-sl');
      expect(presets).toContain('conservative-24h');
    });

    it('should include newly registered presets', () => {
      const beforeCount = listPresets().length;

      registerPreset('new-test-preset' as StrategyPresetName, {
        name: 'New Test',
        profitTargets: [],
      });

      const afterCount = listPresets().length;
      expect(afterCount).toBe(beforeCount + 1);
      expect(listPresets()).toContain('new-test-preset');
    });
  });
});
