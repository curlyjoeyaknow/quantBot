/**
 * Signal Group Normalization Tests
 * =================================
 * Tests for edge cases in SignalGroup normalization to prevent regressions
 * of the config.ts (optional logic) vs types/signals.ts (required logic) mismatch.
 */

import { describe, it, expect } from 'vitest';
import { getSignalPreset, combineSignalPresets } from '@quantbot/simulation';
import type { SignalGroup } from '@quantbot/simulation';

/**
 * Test helper: Normalize SignalGroup (mirrors the implementation in run-lab.ts)
 */
function normalizeSignalGroup(group: {
  logic?: 'AND' | 'OR';
  conditions?: unknown[];
  groups?: unknown[];
  id?: string;
}): SignalGroup {
  return {
    ...group,
    logic: (group.logic ?? 'AND') as 'AND' | 'OR',
    conditions: group.conditions ?? [],
    groups:
      group.groups && group.groups.length > 0
        ? group.groups.map((g) => normalizeSignalGroup(g as typeof group))
        : undefined,
  } as SignalGroup;
}

describe('SignalGroup Normalization Edge Cases', () => {
  it('should handle preset with undefined logic (defaults to AND)', () => {
    const preset = getSignalPreset('entry-rsi-oversold');
    expect(preset).not.toBeNull();
    if (!preset) return;

    // Preset might have undefined logic from config.ts type
    const normalized = normalizeSignalGroup(preset);
    expect(normalized.logic).toBe('AND');
    expect(normalized.conditions).toBeDefined();
  });

  it('should handle preset with explicit AND logic', () => {
    const preset = getSignalPreset('entry-rsi-oversold');
    expect(preset).not.toBeNull();
    if (!preset) return;

    const withLogic = { ...preset, logic: 'AND' as const };
    const normalized = normalizeSignalGroup(withLogic);
    expect(normalized.logic).toBe('AND');
  });

  it('should handle preset with explicit OR logic', () => {
    const preset = getSignalPreset('exit-ichimoku-bearish');
    expect(preset).not.toBeNull();
    if (!preset) return;

    const withLogic = { ...preset, logic: 'OR' as const };
    const normalized = normalizeSignalGroup(withLogic);
    expect(normalized.logic).toBe('OR');
  });

  it('should handle group with undefined conditions (defaults to [])', () => {
    const group: { logic?: 'AND' | 'OR'; conditions?: unknown[]; id?: string } = {
      id: 'test',
      logic: 'AND',
      // conditions is undefined
    };

    const normalized = normalizeSignalGroup(group);
    expect(normalized.conditions).toEqual([]);
    expect(normalized.logic).toBe('AND');
  });

  it('should handle group with undefined groups (defaults to undefined)', () => {
    const group: { logic?: 'AND' | 'OR'; conditions?: unknown[]; groups?: unknown[]; id?: string } =
      {
        id: 'test',
        logic: 'AND',
        conditions: [],
        // groups is undefined
      };

    const normalized = normalizeSignalGroup(group);
    expect(normalized.groups).toBeUndefined();
  });

  it('should handle group with empty groups array (defaults to undefined)', () => {
    const group: { logic?: 'AND' | 'OR'; conditions?: unknown[]; groups?: unknown[]; id?: string } =
      {
        id: 'test',
        logic: 'AND',
        conditions: [],
        groups: [],
      };

    const normalized = normalizeSignalGroup(group);
    expect(normalized.groups).toBeUndefined();
  });

  it('should recursively normalize nested groups', () => {
    const nestedGroup: {
      logic?: 'AND' | 'OR';
      conditions?: unknown[];
      groups?: unknown[];
      id?: string;
    } = {
      id: 'nested',
      // logic is undefined
      conditions: [],
    };

    const parentGroup: {
      logic?: 'AND' | 'OR';
      conditions?: unknown[];
      groups?: unknown[];
      id?: string;
    } = {
      id: 'parent',
      logic: 'AND',
      conditions: [],
      groups: [nestedGroup],
    };

    const normalized = normalizeSignalGroup(parentGroup);
    expect(normalized.groups).toBeDefined();
    expect(normalized.groups?.length).toBe(1);
    expect(normalized.groups?.[0]?.logic).toBe('AND'); // Should default nested logic too
  });

  it('should handle combined presets (combineSignalPresets result)', () => {
    const combined = combineSignalPresets(['entry-rsi-oversold', 'entry-volume-spike'], 'AND');
    expect(combined).not.toBeNull();
    if (!combined) return;

    const normalized = normalizeSignalGroup(combined);
    expect(normalized.logic).toBe('AND');
    expect(normalized.groups).toBeDefined();
    expect(normalized.groups?.length).toBeGreaterThan(0);

    // Recursively check nested groups
    if (normalized.groups) {
      for (const nested of normalized.groups) {
        expect(nested.logic).toBeDefined();
        expect(['AND', 'OR']).toContain(nested.logic);
      }
    }
  });

  it('should handle deeply nested groups', () => {
    const deepNested: {
      logic?: 'AND' | 'OR';
      conditions?: unknown[];
      groups?: unknown[];
      id?: string;
    } = {
      id: 'deep',
      conditions: [],
    };

    const nested: {
      logic?: 'AND' | 'OR';
      conditions?: unknown[];
      groups?: unknown[];
      id?: string;
    } = {
      id: 'nested',
      conditions: [],
      groups: [deepNested],
    };

    const parent: {
      logic?: 'AND' | 'OR';
      conditions?: unknown[];
      groups?: unknown[];
      id?: string;
    } = {
      id: 'parent',
      logic: 'OR',
      conditions: [],
      groups: [nested],
    };

    const normalized = normalizeSignalGroup(parent);
    expect(normalized.logic).toBe('OR');
    expect(normalized.groups?.length).toBe(1);

    const firstNested = normalized.groups?.[0];
    expect(firstNested?.logic).toBe('AND'); // Defaulted
    expect(firstNested?.groups?.length).toBe(1);

    const deep = firstNested?.groups?.[0];
    expect(deep?.logic).toBe('AND'); // Defaulted
  });

  it('should preserve all other properties', () => {
    const group: { logic?: 'AND' | 'OR'; conditions?: unknown[]; groups?: unknown[]; id?: string } =
      {
        id: 'test-id',
        logic: 'OR',
        conditions: [{ indicator: 'rsi', operator: '>' }],
      };

    const normalized = normalizeSignalGroup(group);
    expect(normalized.id).toBe('test-id');
    expect(normalized.logic).toBe('OR');
    expect(normalized.conditions).toHaveLength(1);
  });
});
