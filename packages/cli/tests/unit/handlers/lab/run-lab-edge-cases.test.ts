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
vi.mock('@quantbot/simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/simulation')>();
  return {
    ...actual,
    getSignalPreset: vi.fn(),
    combineSignalPresets: vi.fn(),
    getPreset: vi.fn(),
    simulateStrategy: vi.fn(),
    // Export actual classes for instantiation in createProductionContext
    DuckDBStorageService: actual.DuckDBStorageService,
    ClickHouseService: actual.ClickHouseService,
  };
});

// Mock the workflows package
vi.mock('@quantbot/workflows', () => ({
  evaluateCallsWorkflow: vi.fn().mockResolvedValue({
    results: [],
  }),
  createProductionContextWithPorts: vi.fn().mockResolvedValue({
    ports: {},
    clock: { nowISO: () => new Date().toISOString() },
    ids: { newRunId: () => 'test-run-id' },
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  }),
  createMarketDataStorageAdapter: vi.fn().mockReturnValue({
    getCandles: vi.fn().mockResolvedValue([]),
  }),
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
    // NOTE: These tests are for deprecated functionality (presets).
    // The current handler uses 'overlays' instead of presets.
    // These tests are kept for backwards compatibility but may need updating.
    it.skip('should throw error when entryPreset does not exist', async () => {
      // Handler no longer uses entryPreset - uses overlays instead
      vi.mocked(getSignalPreset).mockReturnValue(null);

      const args = {
        entryPreset: 'nonexistent-preset',
        limit: 10,
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid entry preset: nonexistent-preset'
      );
    });

    it.skip('should throw error when exitPreset does not exist', async () => {
      // Handler no longer uses exitPreset - uses overlays instead
      vi.mocked(getSignalPreset)
        .mockReturnValueOnce({ logic: 'AND', conditions: [] } as any) // entry preset exists
        .mockReturnValueOnce(null); // exit preset does not exist

      const args = {
        entryPreset: 'valid-entry',
        exitPreset: 'nonexistent-exit',
        limit: 10,
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid exit preset: nonexistent-exit'
      );
    });

    it.skip('should throw error when entryPresets contains invalid preset', async () => {
      // Handler no longer uses entryPresets - uses overlays instead
      vi.mocked(combineSignalPresets).mockReturnValue(null);

      const args = {
        entryPresets: ['valid-preset', 'invalid-preset'],
        limit: 10,
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid entry preset(s): valid-preset, invalid-preset'
      );
    });

    it.skip('should throw error when exitPresets contains invalid preset', async () => {
      // Handler no longer uses exitPresets - uses overlays instead
      vi.mocked(getSignalPreset).mockReturnValue({ logic: 'AND', conditions: [] } as any);
      vi.mocked(combineSignalPresets).mockReturnValueOnce(null); // exit presets invalid

      vi.mocked(getPreset).mockReturnValue({
        name: 'test-strategy',
        profitTargets: [],
      } as any);

      const args = {
        entryPreset: 'valid-entry',
        exitPresets: ['invalid-exit'],
        strategyPreset: 'test-strategy',
        limit: 10,
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      await expect(runLabHandler(args as any, mockCtx)).rejects.toThrow(
        'Invalid exit preset(s): invalid-exit'
      );
    });
  });

  describe('SignalGroup normalization edge cases', () => {
    // NOTE: These tests are for deprecated functionality (presets).
    // The current handler uses 'overlays' instead of presets.
    it.skip('should handle SignalGroup with undefined logic', async () => {
      // Handler no longer uses SignalGroups - uses overlays instead
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
        entryPreset: 'test-signal',
        strategyPreset: 'test-strategy',
        limit: 10,
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      const result = await runLabHandler(args as any, mockCtx);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it.skip('should handle SignalGroup with nested groups missing logic', async () => {
      // Handler no longer uses SignalGroups - uses overlays instead
      const signalGroupWithNested = {
        id: 'parent-signal',
        logic: 'AND',
        groups: [
          {
            id: 'child-signal',
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
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      await expect(runLabHandler(args as any, mockCtx)).resolves.toBeDefined();
    });

    it.skip('should handle SignalGroup with OR logic', async () => {
      // Handler no longer uses SignalGroups - uses overlays instead
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
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
      };

      await expect(runLabHandler(args as any, mockCtx)).resolves.toBeDefined();
    });
  });

  describe('Empty and missing arguments', () => {
    // NOTE: Schema validation happens in the executor (execute.ts), not in the handler.
    // The handler receives already-validated args, so it won't throw validation errors.
    // These tests verify handler behavior with invalid args (which shouldn't happen in practice).

    it('should handle empty overlays array gracefully', async () => {
      // Handler receives already-validated args, so empty overlays won't reach here
      // But if it does, handler should handle it gracefully
      const args = {
        overlays: [],
        limit: 10,
      };

      // Handler may return empty result or throw - depends on workflow behavior
      // For now, test that it doesn't crash
      const result = await runLabHandler(args as any, mockCtx);
      expect(result).toBeDefined();
    });

    it('should handle missing overlays gracefully', async () => {
      // Handler receives already-validated args, so missing overlays won't reach here
      const args = {
        limit: 10,
      } as any;

      // Handler may return empty result or throw - depends on workflow behavior
      // For now, test that it doesn't crash
      const result = await runLabHandler(args, mockCtx);
      expect(result).toBeDefined();
    });

    it('should handle valid overlays', async () => {
      const args = {
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
        limit: 10,
      };

      // Should work with valid overlays
      const result = await runLabHandler(args as any, mockCtx);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid strategy preset', () => {
    it.skip('should throw error when strategyPreset does not exist', async () => {
      // Handler no longer uses strategyPreset - uses overlays instead
      vi.mocked(getPreset).mockReturnValue(null);

      const args = {
        strategyPreset: 'nonexistent-strategy',
        limit: 10,
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
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

      const args = {
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
        limit: 10,
      };

      // Handler uses createProductionContextWithPorts which creates its own storageEngine
      // The invalidCtx.storageEngine won't be used, but if workflow needs it, errors will be caught
      // For now, this test may need adjustment based on actual workflow behavior
      const result = await runLabHandler(args as any, invalidCtx);
      // Result should be defined (workflow may handle errors internally)
      expect(result).toBeDefined();
    });
  });

  describe('Date range filtering', () => {
    it('should handle calls outside date range', async () => {
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
        from: '2025-12-01T00:00:00Z',
        to: '2025-12-31T23:59:59Z',
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
        limit: 10,
      };

      const result = await runLabHandler(args as any, mockCtx);
      // Only token2 should be in range, so only 1 call should be simulated
      expect(result.callsSimulated).toBe(1);
    });
  });

  describe('Empty results handling', () => {
    it('should return empty result when no calls found', async () => {
      mockCtx.services.duckdbStorage = vi.fn().mockReturnValue({
        queryCalls: vi.fn().mockResolvedValue({
          success: true,
          calls: [],
        }),
      }) as any;

      const args = {
        overlays: [{ take_profit: { target: 2, percent: 1.0 } }],
        limit: 10,
      };

      const result = await runLabHandler(args as any, mockCtx);
      expect(result.callsSimulated).toBe(0);
      expect(result.callsSucceeded).toBe(0);
      expect(result.callsFailed).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});
