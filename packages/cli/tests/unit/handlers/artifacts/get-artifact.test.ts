/**
 * Tests for get artifact handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getArtifactHandler } from '../../../../src/handlers/artifacts/get-artifact.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('getArtifactHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockCtx = {
      services: {},
    } as CommandContext;
  });

  it('should return not found (stub implementation)', async () => {
    const args = {
      id: 'strategy-123',
      version: undefined,
      format: 'table' as const,
    };

    const result = await getArtifactHandler(args, mockCtx);

    expect(result).toEqual({
      artifact: null,
      found: false,
    });
  });

  it('should handle version parameter', async () => {
    const args = {
      id: 'strategy-123',
      version: '2.0.0',
      format: 'json' as const,
    };

    const result = await getArtifactHandler(args, mockCtx);

    expect(result.found).toBe(false);
    expect(result.artifact).toBeNull();
  });

  it('should handle missing version (latest)', async () => {
    const args = {
      id: 'strategy-123',
      version: undefined,
      format: 'table' as const,
    };

    const result = await getArtifactHandler(args, mockCtx);

    expect(result.found).toBe(false);
  });
});

