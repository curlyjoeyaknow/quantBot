/**
 * SignalCondition Field Defaulting Tests
 * =======================================
 * Tests to ensure field property defaults correctly to 'value' when omitted.
 * This prevents regressions of the fix for optional field with default value.
 */

import { describe, it, expect } from 'vitest';
import { SignalConditionSchema } from '../../../src/config.js';

describe('SignalCondition field defaulting', () => {
  it('should default field to "value" when omitted', () => {
    const condition = SignalConditionSchema.parse({
      indicator: 'rsi',
      operator: '<',
      value: 30,
      // field is omitted
    });

    expect(condition.field).toBe('value');
  });

  it('should use provided field value when specified', () => {
    const condition = SignalConditionSchema.parse({
      indicator: 'price_change',
      field: 'close',
      operator: '>',
      value: 100,
    });

    expect(condition.field).toBe('close');
  });

  it('should accept undefined field and default to "value"', () => {
    const condition = SignalConditionSchema.parse({
      indicator: 'rsi',
      operator: '>',
      value: 70,
      field: undefined,
    });

    expect(condition.field).toBe('value');
  });

  it('should allow field to be optional in TypeScript types', () => {
    // This test verifies that the type system allows field to be optional
    const conditionWithoutField: {
      indicator: string;
      operator: string;
      value: number;
      field?: string;
    } = {
      indicator: 'rsi',
      operator: '<',
      value: 30,
    };

    const parsed = SignalConditionSchema.parse(conditionWithoutField);
    expect(parsed.field).toBe('value');
  });

  it('should handle field in presets that omit it', () => {
    // Simulate a preset structure that omits field
    const presetCondition = {
      indicator: 'rsi' as const,
      operator: '<' as const,
      value: 30,
    };

    const parsed = SignalConditionSchema.parse(presetCondition);
    expect(parsed.field).toBe('value');
  });

  it('should preserve custom field values in complex conditions', () => {
    const condition = SignalConditionSchema.parse({
      indicator: 'ichimoku_cloud',
      field: 'isBullish',
      operator: '==',
      value: 1,
    });

    expect(condition.field).toBe('isBullish');
  });
});
