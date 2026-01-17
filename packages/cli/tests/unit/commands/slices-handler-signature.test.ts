/**
 * Slice Commands Handler Signature Tests
 *
 * Tests that handler signatures match the CommandDefinition interface:
 * - Handler accepts CommandContext | unknown
 * - Handler can be called with plain objects (REPL-friendly)
 * - Type safety is maintained
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commandRegistry } from '../../../src/core/command-registry.js';
import type { CommandContext } from '../../../src/core/command-context.js';

// Import commands module to trigger registration
import '../../../src/commands/slices.js';

// Mock dependencies
vi.mock('@quantbot/workflows', () => ({
  exportAndAnalyzeSlice: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@quantbot/infra/storage', () => ({
  createClickHouseSliceExporterAdapterImpl: vi.fn().mockReturnValue({}),
  createDuckDbSliceAnalyzerAdapterImpl: vi.fn().mockReturnValue({}),
  createSliceValidatorAdapter: vi.fn().mockReturnValue({
    validate: vi.fn().mockResolvedValue({ ok: true, errors: [], warnings: [] }),
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ manifestId: 'test' })),
    },
  };
});

describe('Slice Commands - Handler Signature', () => {
  describe('Handler type compatibility', () => {
    it('should have handlers that accept CommandContext | unknown', () => {
      const exportCommand = commandRegistry.getCommand('slices', 'export');
      const validateCommand = commandRegistry.getCommand('slices', 'validate');

      expect(exportCommand).toBeDefined();
      expect(validateCommand).toBeDefined();

      // Handlers should accept unknown context
      const mockCtx = {
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
      } as unknown;
      const mockArgs = {};

      // Should not throw type errors
      // Note: We're just checking type compatibility, not actually executing
      expect(() => {
        if (exportCommand?.handler) {
          // Type check: handler should accept unknown context
          const handler: (args: unknown, ctx: CommandContext | unknown) => Promise<unknown> =
            exportCommand.handler;
          // Type check only - don't actually call it
          const _typeCheck: (args: unknown, ctx: CommandContext | unknown) => Promise<unknown> =
            handler;
          void _typeCheck;
        }
      }).not.toThrow();

      expect(() => {
        if (validateCommand?.handler) {
          const handler: (args: unknown, ctx: CommandContext | unknown) => Promise<unknown> =
            validateCommand.handler;
          // Type check only - don't actually call it
          const _typeCheck: (args: unknown, ctx: CommandContext | unknown) => Promise<unknown> =
            handler;
          void _typeCheck;
        }
      }).not.toThrow();
    });

    it('should allow handlers to be called with plain objects (REPL-friendly)', async () => {
      const exportCommand = commandRegistry.getCommand('slices', 'export');

      if (!exportCommand) {
        throw new Error('Export command not found');
      }

      const mockCtx = {
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
      } as unknown as CommandContext;

      const mockArgs = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      // Should be callable with plain objects
      // Note: This will call the real handler which uses mocks, so it should work
      const result = await exportCommand.handler(mockArgs, mockCtx);
      expect(result).toBeDefined();
    });
  });

  describe('Handler isolation', () => {
    it('should allow handlers to be imported and called directly', async () => {
      // This test verifies handlers can be used outside CLI infrastructure
      const { exportSliceHandler } = await import('../../../src/handlers/slices/export-slice.js');

      const mockCtx = {
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
      } as unknown as CommandContext;

      const exportArgs = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      // Should be callable directly (mocks are already set up at module level)
      await expect(exportSliceHandler(exportArgs, mockCtx)).resolves.toBeDefined();
    });
  });
});
