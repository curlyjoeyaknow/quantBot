/**
 * Validate Slice Handler Edge Cases Tests
 *
 * Tests edge cases and error scenarios for validateSliceHandler:
 * - Invalid file paths
 * - Malformed JSON
 * - Missing manifest fields
 * - Invalid context
 * - File read errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSliceHandler } from '../../../../src/handlers/slices/validate-slice.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { promises as fs } from 'fs';
import { createSliceValidatorAdapter } from '@quantbot/infra/storage';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

// Mock both storage paths (consolidation shim and new path)
vi.mock('@quantbot/storage', () => ({
  createSliceValidatorAdapter: vi.fn(),
}));
vi.mock('@quantbot/infra/storage', () => ({
  createSliceValidatorAdapter: vi.fn(),
}));

// Mock findWorkspaceRoot to return the actual workspace root
// This is needed because slice-validator-adapter loads the manifest schema at module load time
vi.mock('@quantbot/infra/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/infra/utils')>('@quantbot/infra/utils');
  // Use process.cwd() to get workspace root (Vitest runs from workspace root)
  const workspaceRoot = process.cwd();
  return {
    ...actual,
    findWorkspaceRoot: vi.fn(() => workspaceRoot),
  };
});

describe('validateSliceHandler - Edge Cases', () => {
  let mockCtx: CommandContext;
  let mockValidator: ReturnType<typeof createSliceValidatorAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockValidator = {
      validate: vi.fn().mockResolvedValue({
        ok: true,
        errors: [],
        warnings: [],
      }),
    } as any;

    vi.mocked(createSliceValidatorAdapter).mockReturnValue(mockValidator);

    mockCtx = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandContext;
  });

  describe('File reading errors', () => {
    it('should handle file not found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const args = {
        manifest: '/nonexistent/path/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });

    it('should handle permission denied', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('EACCES: permission denied'));

      const args = {
        manifest: '/root/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });

    it('should handle file read timeout', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ETIMEDOUT'));

      const args = {
        manifest: '/path/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });
  });

  describe('JSON parsing errors', () => {
    it('should handle invalid JSON syntax', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{ invalid json }');

      const args = {
        manifest: '/path/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });

    it('should handle empty file', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('');

      const args = {
        manifest: '/path/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });

    it('should handle non-JSON content', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('This is not JSON');

      const args = {
        manifest: '/path/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });

    it('should handle JSON with trailing comma by throwing parse error', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{"manifestId": "test",}');

      const args = {
        manifest: '/path/manifest.json',
      };

      // JSON.parse does not accept trailing commas - should throw
      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow();
    });
  });

  describe('Manifest validation', () => {
    it('should handle missing manifestId', async () => {
      const manifest = {
        version: 1,
        // missing manifestId
        parquetFiles: [], // Required field
        createdAtIso: '2024-01-01T00:00:00Z',
        run: { runId: 'test', createdAtIso: '2024-01-01T00:00:00Z' },
        spec: { dataset: 'test', chain: 'solana', timeRange: { startIso: '2024-01-01', endIso: '2024-01-02' } },
        layout: { baseUri: 'file:///test', subdirTemplate: 'test' },
        summary: { totalFiles: 0 },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));
      vi.mocked(mockValidator.validate).mockResolvedValue({
        ok: false,
        errors: ['Missing required field: manifestId'],
        warnings: [],
      });

      const args = {
        manifest: '/path/manifest.json',
      };

      const result = await validateSliceHandler(args, mockCtx);
      expect(result).toBeDefined();
      // Validator should catch missing manifestId
    });

    it('should handle invalid manifest structure', async () => {
      const manifest = {
        manifestId: 'test',
        version: 1,
        parquetFiles: [], // Required field
        createdAtIso: '2024-01-01T00:00:00Z',
        run: { runId: 'test', createdAtIso: '2024-01-01T00:00:00Z' },
        spec: { dataset: 'test', chain: 'solana', timeRange: { startIso: '2024-01-01', endIso: '2024-01-02' } },
        layout: { baseUri: 'file:///test', subdirTemplate: 'test' },
        summary: { totalFiles: 0 },
        // missing some required fields
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));
      vi.mocked(mockValidator.validate).mockResolvedValue({
        ok: false,
        errors: ['Missing required field: version'],
        warnings: [],
      });

      const args = {
        manifest: '/path/manifest.json',
      };

      const result = (await validateSliceHandler(args, mockCtx)) as any;
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('Missing required field: version');
    });

    it('should handle manifest with warnings', async () => {
      const manifest = {
        manifestId: 'test',
        version: 1,
        parquetFiles: [],
        createdAtIso: '2024-01-01T00:00:00Z',
        run: { runId: 'test', createdAtIso: '2024-01-01T00:00:00Z' },
        spec: { dataset: 'test', chain: 'solana', timeRange: { startIso: '2024-01-01', endIso: '2024-01-02' } },
        layout: { baseUri: 'file:///test', subdirTemplate: 'test' },
        summary: { totalFiles: 0 },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));
      vi.mocked(mockValidator.validate).mockResolvedValue({
        ok: true,
        errors: [],
        warnings: ['Deprecated field: oldField'],
      });

      const args = {
        manifest: '/path/manifest.json',
      };

      const result = (await validateSliceHandler(args, mockCtx)) as any;
      expect(result.ok).toBe(true);
      expect(result.warnings).toContain('Deprecated field: oldField');
    });
  });

  describe('Context validation', () => {
    it('should call ensureInitialized', async () => {
      const manifest = {
        manifestId: 'test',
        version: '1.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));

      const args = {
        manifest: '/path/manifest.json',
      };

      await validateSliceHandler(args, mockCtx);
      expect(mockCtx.ensureInitialized).toHaveBeenCalled();
    });

    it('should handle context without ensureInitialized', async () => {
      const invalidCtx = {} as unknown as CommandContext;

      const manifest = {
        manifestId: 'test',
        version: 1,
        parquetFiles: [],
        createdAtIso: '2024-01-01T00:00:00Z',
        run: { runId: 'test', createdAtIso: '2024-01-01T00:00:00Z' },
        spec: { dataset: 'test', chain: 'solana', timeRange: { startIso: '2024-01-01', endIso: '2024-01-02' } },
        layout: { baseUri: 'file:///test', subdirTemplate: 'test' },
        summary: { totalFiles: 0 },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));

      const args = {
        manifest: '/path/manifest.json',
      };

      await expect(validateSliceHandler(args, invalidCtx)).rejects.toThrow();
    });
  });

  describe('Validator errors', () => {
    it('should handle validator throwing error', async () => {
      const manifest = {
        manifestId: 'test',
        version: 1,
        parquetFiles: [],
        createdAtIso: '2024-01-01T00:00:00Z',
        run: { runId: 'test', createdAtIso: '2024-01-01T00:00:00Z' },
        spec: { dataset: 'test', chain: 'solana', timeRange: { startIso: '2024-01-01', endIso: '2024-01-02' } },
        layout: { baseUri: 'file:///test', subdirTemplate: 'test' },
        summary: { totalFiles: 0 },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));
      vi.mocked(mockValidator.validate).mockRejectedValue(new Error('Validator error'));

      const args = {
        manifest: '/path/manifest.json',
      };

      await expect(validateSliceHandler(args, mockCtx)).rejects.toThrow('Validator error');
    });

    it('should propagate validation errors', async () => {
      const manifest = {
        manifestId: 'test',
        version: '1.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));
      vi.mocked(mockValidator.validate).mockResolvedValue({
        ok: false,
        errors: ['Error 1', 'Error 2'],
        warnings: [],
      });

      const args = {
        manifest: '/path/manifest.json',
      };

      const result = (await validateSliceHandler(args, mockCtx)) as any;
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['Error 1', 'Error 2']);
    });
  });

  describe('Path handling', () => {
    it('should handle relative paths', async () => {
      const manifest = {
        manifestId: 'test',
        version: '1.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));

      const args = {
        manifest: './slices/manifest.json',
      };

      await validateSliceHandler(args, mockCtx);
      expect(fs.readFile).toHaveBeenCalledWith('./slices/manifest.json', 'utf-8');
    });

    it('should handle absolute paths', async () => {
      const manifest = {
        manifestId: 'test',
        version: '1.0',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(manifest));

      const args = {
        manifest: '/absolute/path/manifest.json',
      };

      await validateSliceHandler(args, mockCtx);
      expect(fs.readFile).toHaveBeenCalledWith('/absolute/path/manifest.json', 'utf-8');
    });
  });
});
