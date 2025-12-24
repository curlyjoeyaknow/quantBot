/**
 * Export Slice Handler Edge Cases Tests
 * 
 * Tests edge cases and error scenarios for exportSliceHandler:
 * - Invalid context
 * - Missing required args
 * - Invalid date formats
 * - Empty token lists
 * - Invalid output directories
 * - Malformed SQL analysis
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSliceHandler } from '../../../../src/handlers/slices/export-slice.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { exportAndAnalyzeSlice } from '@quantbot/workflows';

vi.mock('@quantbot/workflows', () => ({
  exportAndAnalyzeSlice: vi.fn(),
}));

vi.mock('@quantbot/storage', () => ({
  createClickHouseSliceExporterAdapterImpl: vi.fn().mockReturnValue({}),
  createDuckDbSliceAnalyzerAdapterImpl: vi.fn().mockReturnValue({}),
}));

describe('exportSliceHandler - Edge Cases', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockCtx = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandContext;

    vi.mocked(exportAndAnalyzeSlice).mockResolvedValue({
      runId: 'test-run-id',
      success: true,
    } as any);
  });

  describe('Context validation', () => {
    it('should call ensureInitialized', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      expect(mockCtx.ensureInitialized).toHaveBeenCalled();
    });

    it('should handle context without ensureInitialized', async () => {
      const invalidCtx = {} as unknown as CommandContext;

      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      await expect(exportSliceHandler(args, invalidCtx)).rejects.toThrow();
    });
  });

  describe('Token list parsing', () => {
    it('should handle empty token string', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        tokens: '',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.spec.tokenIds).toBeUndefined();
    });

    it('should handle single token', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        tokens: 'So11111111111111111111111111111111111111112',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.spec.tokenIds).toEqual(['So11111111111111111111111111111111111111112']);
    });

    it('should handle multiple tokens with spaces', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        tokens: 'So11111111111111111111111111111111111111112, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.spec.tokenIds).toEqual([
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      ]);
    });

    it('should handle tokens with extra whitespace', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        tokens: '  token1  ,  token2  ,  token3  ',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.spec.tokenIds).toEqual(['token1', 'token2', 'token3']);
    });
  });

  describe('Analysis SQL handling', () => {
    it('should use default SQL when analysis is not provided', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.analysis.sql).toBe('SELECT COUNT(*) as total_rows FROM slice');
    });

    it('should use custom SQL when analysis is provided', async () => {
      const customSQL = 'SELECT token_address, COUNT(*) FROM slice GROUP BY token_address';
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        analysis: customSQL,
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.analysis.sql).toBe(customSQL);
    });
  });

  describe('Date handling', () => {
    it('should pass ISO date strings as-is', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01T00:00:00Z',
        to: '2025-12-02T23:59:59Z',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.spec.timeRange.startIso).toBe('2025-12-01T00:00:00Z');
      expect(callArgs?.spec.timeRange.endIso).toBe('2025-12-02T23:59:59Z');
    });
  });

  describe('Output directory handling', () => {
    it('should handle relative paths', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.layout.baseUri).toBe('file://./slices');
    });

    it('should handle absolute paths', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: '/tmp/slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.layout.baseUri).toBe('file:///tmp/slices');
    });
  });

  describe('Run ID generation', () => {
    it('should generate unique run IDs', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      await exportSliceHandler(args, mockCtx);
      
      const call1 = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      const call2 = vi.mocked(exportAndAnalyzeSlice).mock.calls[1]?.[0];
      
      expect(call1?.run.runId).not.toBe(call2?.run.runId);
    });

    it('should generate run IDs with slice prefix', async () => {
      const args = {
        dataset: 'candles_1m',
        chain: 'sol',
        from: '2025-12-01',
        to: '2025-12-02',
        outputDir: './slices',
      };

      await exportSliceHandler(args, mockCtx);
      
      const callArgs = vi.mocked(exportAndAnalyzeSlice).mock.calls[0]?.[0];
      expect(callArgs?.run.runId).toMatch(/^slice_\d+_[a-z0-9]+$/);
    });
  });
});

