/**
 * Lab Handler Edge Cases Tests
 *
 * Tests edge cases and error scenarios for runLabHandler:
 * - Invalid preset names
 * - Missing presets
 * - Nested SignalGroups with missing logic
 * - Empty preset arrays
 * - Invalid context
 * - Missing required args
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLabHandler } from '../../../../src/handlers/lab/run-lab.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';
import {
  getSignalPreset,
  combineSignalPresets,
  getPreset,
  simulateStrategy,
} from '@quantbot/simulation';

// Mock the simulation package
vi.mock('@quantbot/simulation', () => ({
  getSignalPreset: vi.fn(),
  combineSignalPresets: vi.fn(),
  getPreset: vi.fn(),
  simulateStrategy: vi.fn(),
}));

describe('runLabHandler - Edge Cases', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a minimal mock context
    mockCtx = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      services: {
        duckdbStorage: vi.fn().mockReturnValue({
          queryCalls: vi.fn().mockResolvedValue({
            success: true,
            calls: [],
          }),
        }),
        storageEngine: vi.fn().mockReturnValue({
          getCandles: vi.fn().mockResolvedValue([]),
        }),
      },
    } as unknown as CommandContext;
  });

  describe('Invalid preset handling', () => {
    it('should throw error when entryPreset does not exist', async () => {
      vi.mocked(getSignalPreset).mockReturnValue(null);

      const args = {
        entryPreset: 'nonexistent-preset',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid entry preset: nonexistent-preset'
      );
    });

    it('should throw error when exitPreset does not exist', async () => {
      vi.mocked(getSignalPreset)
        .mockReturnValueOnce({ logic: 'AND', conditions: [] } as any) // entry preset exists
        .mockReturnValueOnce(null); // exit preset does not exist

      const args = {
        entryPreset: 'valid-entry',
        exitPreset: 'nonexistent-exit',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid exit preset: nonexistent-exit'
      );
    });

    it('should throw error when entryPresets contains invalid preset', async () => {
      vi.mocked(combineSignalPresets).mockReturnValue(null);

      const args = {
        entryPresets: ['valid-preset', 'invalid-preset'],
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid entry preset(s): valid-preset, invalid-preset'
      );
    });

    it('should throw error when exitPresets contains invalid preset', async () => {
      // When exitPresets is provided but combineSignalPresets returns null, it should throw
      // This happens before any calls are processed, so it should always throw
      vi.mocked(getSignalPreset).mockReturnValue({ logic: 'AND', conditions: [] } as any);
      // Since we use entryPreset (not entryPresets), combineSignalPresets is only called for exitPresets
      vi.mocked(combineSignalPresets).mockReturnValueOnce(null); // exit presets invalid

      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPreset: 'valid-entry', // Use entryPreset, not entryPresets (so combineSignalPresets not called for entry)
        exitPresets: ['invalid-exit'],
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // This should throw immediately when exitPresets validation fails
      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid exit preset(s): invalid-exit'
      );
    });
  });

  describe('SignalGroup normalization edge cases', () => {
    it('should handle SignalGroup with undefined logic', async () => {
      const signalGroupWithoutLogic = {
        id: 'test-signal',
        conditions: [],
      };

      vi.mocked(getSignalPreset).mockReturnValue(signalGroupWithoutLogic as any);
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPreset: 'test-signal', // This is the preset name, not the signal ID
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // Should not throw - normalizeSignalGroup should set default logic
      const result = await runLabHandler(args as any, mockCtx);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should handle SignalGroup with nested groups missing logic', async () => {
      const signalGroupWithNested = {
        id: 'parent-signal',
        logic: 'AND',
        groups: [
          {
            id: 'child-signal',
            // missing logic
            conditions: [],
          },
        ],
      };

      vi.mocked(getSignalPreset).mockReturnValue(signalGroupWithNested as any);
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPreset: 'test-signal',
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // Should not throw - normalizeSignalGroup should handle nested groups
      await expect(runLabHandler(args as any, mockCtx)).resolves.toBeDefined();
    });

    it('should handle SignalGroup with OR logic', async () => {
      const signalGroupWithOR = {
        id: 'or-signal',
        logic: 'OR',
        conditions: [],
      };

      vi.mocked(getSignalPreset).mockReturnValue(signalGroupWithOR as any);
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPreset: 'test-signal',
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      await expect(runLabHandler(args as any, mockCtx)).resolves.toBeDefined();
    });
  });

  describe('Empty and missing arguments', () => {
    it('should handle empty entryPresets array by returning empty result', async () => {
      vi.mocked(combineSignalPresets).mockReturnValue(null);
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPresets: [],
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // Handler returns empty result when no calls found, not an error
      const result = await runLabHandler(args as any, mockCtx);
      expect(result.callsSimulated).toBe(0);
    });

    it('should handle missing both entryPreset and entryPresets', async () => {
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // Should work - entry signal is optional
      await expect(runLabHandler(args as any, mockCtx)).resolves.toBeDefined();
    });

    it('should handle missing both exitPreset and exitPresets', async () => {
      vi.mocked(getSignalPreset).mockReturnValue({ logic: 'AND', conditions: [] } as any);
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPreset: 'valid-entry',
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // Should work - exit signal is optional
      await expect(runLabHandler(args as any, mockCtx)).resolves.toBeDefined();
    });
  });

  describe('Invalid strategy preset', () => {
    it('should throw error when strategyPreset does not exist', async () => {
      vi.mocked(getPreset).mockReturnValue(null);

      const args = {
        strategyPreset: 'nonexistent-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid strategy preset: nonexistent-strategy'
      );
    });
  });

  describe('Context validation', () => {
    it('should handle missing duckdbStorage service', async () => {
      const invalidCtx = {
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
        services: {
          // Missing duckdbStorage
        },
      } as unknown as CommandContext;

      const args = {
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      await expect(runLabHandler(args as any, invalidCtx)).rejects.toThrow();
    });

    it('should handle missing storageEngine service by catching error in results', async () => {
      // Create a context where storageEngine returns undefined
      const invalidCtx = {
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
        services: {
          duckdbStorage: vi.fn().mockReturnValue({
            queryCalls: vi.fn().mockResolvedValue({
              success: true,
              calls: [
                {
                  mint: 'test',
                  alert_timestamp: DateTime.now().toISO(), // Use current date to pass date filter
                },
              ],
            }),
          }),
          storageEngine: vi.fn().mockReturnValue(undefined), // Returns undefined instead of service
        },
      } as unknown as CommandContext;

      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      // Handler catches errors and adds them to results instead of throwing
      // When storageEngine is undefined, calling getCandles will throw
      const result = await runLabHandler(args as any, invalidCtx);
      expect(result.callsFailed).toBeGreaterThan(0);
      // Error will be caught and added to results with errorCode 'SIMULATION_ERROR'
      const failedResults = result.results.filter((r: any) => !r.ok);
      expect(failedResults.length).toBeGreaterThan(0);
      // Check that at least one has an error message (the error from getCandles)
      expect(
        failedResults.some((r: any) => r.errorMessage && r.errorCode === 'SIMULATION_ERROR')
      ).toBe(true);
    });
  });

  describe('Date range filtering', () => {
    it('should handle calls outside date range', async () => {
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const calls = [
        { mint: 'token1', alert_timestamp: '2023-01-01T00:00:00Z' }, // Too old
        { mint: 'token2', alert_timestamp: '2025-12-25T00:00:00Z' }, // In range
      ];

      mockCtx.services.duckdbStorage = vi.fn().mockReturnValue({
        queryCalls: vi.fn().mockResolvedValue({
          success: true,
          calls,
        }),
      }) as any;

      const args = {
        from: '2025-12-01',
        to: '2025-12-31',
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      const result = await runLabHandler(args as any, mockCtx);
      expect(result.callsSimulated).toBeLessThanOrEqual(calls.length);
    });
  });

  describe('Empty results handling', () => {
    it('should return empty result when no calls found', async () => {
      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      mockCtx.services.duckdbStorage = vi.fn().mockReturnValue({
        queryCalls: vi.fn().mockResolvedValue({
          success: true,
          calls: [],
        }),
      }) as any;

      const args = {
        strategyPreset: 'test-strategy',
        limit: 10,
        preWindow: 260,
        postWindow: 1440,
      };

      const result = await runLabHandler(args as any, mockCtx);
      expect(result.callsSimulated).toBe(0);
      expect(result.callsSucceeded).toBe(0);
      expect(result.callsFailed).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});
