/**
 * Registry Rebuild Handler Tests
 *
 * Tests for registry rebuild handler following CLI handler pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registryRebuildHandler } from '../../../../src/handlers/registry/rebuild.js';
import type { PythonEngine } from '@quantbot/infra/utils';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('registryRebuildHandler', () => {
  let mockPythonEngine: PythonEngine;
  let mockContext: CommandContext;

  const mockRebuildResult = {
    success: true,
    summary: {
      runsets: 10,
      runs: 47,
      artifacts: 235,
      resolutions: 15,
      membership: 47,
    },
    tables: {
      runsets: 10,
      runs: 47,
      artifacts: 235,
      resolutions: 15,
      tags: 5,
    },
  };

  beforeEach(() => {
    mockPythonEngine = {
      runScript: vi.fn().mockResolvedValue(mockRebuildResult),
    } as unknown as PythonEngine;

    mockContext = {
      services: {
        pythonEngine: () => mockPythonEngine,
      },
    } as unknown as CommandContext;
  });

  it('should rebuild registry successfully', async () => {
    const result = await registryRebuildHandler({ force: false }, mockContext);

    expect(result.success).toBe(true);
    expect(result.summary.runsets).toBe(10);
    expect(result.summary.runs).toBe(47);
    expect(result.summary.artifacts).toBe(235);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('rebuilt successfully');

    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.stringContaining('runset_registry_rebuild.py'),
      expect.objectContaining({
        force: false,
      }),
      expect.anything()
    );
  });

  it('should force rebuild when requested', async () => {
    const result = await registryRebuildHandler({ force: true }, mockContext);

    expect(result.success).toBe(true);
    expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        force: true,
      }),
      expect.anything()
    );
  });

  it('should propagate errors from Python script', async () => {
    const error = new Error('DuckDB connection failed');
    vi.mocked(mockPythonEngine.runScript).mockRejectedValue(error);

    await expect(registryRebuildHandler({ force: false }, mockContext)).rejects.toThrow(
      'DuckDB connection failed'
    );
  });

  // Isolation test
  it('should be callable with plain objects', async () => {
    const plainContext = {
      services: {
        pythonEngine: () => ({
          runScript: async () => mockRebuildResult,
        }),
      },
    };

    const result = await registryRebuildHandler({ force: false }, plainContext as CommandContext);

    expect(result.success).toBe(true);
    expect(result.summary.runsets).toBe(10);
  });
});

