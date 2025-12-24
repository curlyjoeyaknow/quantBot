/**
 * Slice Commands Handler Signature Tests
 * 
 * Tests that handler signatures match the CommandDefinition interface:
 * - Handler accepts CommandContext | unknown
 * - Handler can be called with plain objects (REPL-friendly)
 * - Type safety is maintained
 */

import { describe, it, expect, vi } from 'vitest';
import { commandRegistry } from '../../../src/core/command-registry.js';
import type { CommandContext } from '../../../src/core/command-context.js';

describe('Slice Commands - Handler Signature', () => {
  describe('Handler type compatibility', () => {
    it('should have handlers that accept CommandContext | unknown', () => {
      const exportCommand = commandRegistry.getCommand('slices', 'export');
      const validateCommand = commandRegistry.getCommand('slices', 'validate');

      expect(exportCommand).toBeDefined();
      expect(validateCommand).toBeDefined();

      // Handlers should accept unknown context
      const mockCtx = {} as unknown;
      const mockArgs = {};

      // Should not throw type errors
      expect(() => {
        if (exportCommand?.handler) {
          // Type check: handler should accept unknown context
          const handler: (args: unknown, ctx: CommandContext | unknown) => Promise<unknown> =
            exportCommand.handler;
          void handler(mockArgs, mockCtx);
        }
      }).not.toThrow();

      expect(() => {
        if (validateCommand?.handler) {
          const handler: (args: unknown, ctx: CommandContext | unknown) => Promise<unknown> =
            validateCommand.handler;
          void handler(mockArgs, mockCtx);
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
      await expect(
        exportCommand.handler(mockArgs, mockCtx)
      ).resolves.toBeDefined();
    });
  });

  describe('Handler isolation', () => {
    it('should allow handlers to be imported and called directly', async () => {
      // This test verifies handlers can be used outside CLI infrastructure
      const { exportSliceHandler } = await import('../../../src/handlers/slices/export-slice.js');
      const { validateSliceHandler } = await import('../../../src/handlers/slices/validate-slice.js');

      const mockCtx = {
        ensureInitialized: vi.fn().mockResolvedValue(undefined),
      } as unknown as CommandContext;

      // Mock the workflow
      vi.doMock('@quantbot/workflows', () => ({
        exportAndAnalyzeSlice: vi.fn().mockResolvedValue({ success: true }),
      }));

      vi.doMock('@quantbot/storage', () => ({
        createClickHouseSliceExporterAdapterImpl: vi.fn().mockReturnValue({}),
        createDuckDbSliceAnalyzerAdapterImpl: vi.fn().mockReturnValue({}),
      }));

      const exportArgs = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      // Should be callable directly
      await expect(exportSliceHandler(exportArgs, mockCtx)).resolves.toBeDefined();
    });
  });
});

