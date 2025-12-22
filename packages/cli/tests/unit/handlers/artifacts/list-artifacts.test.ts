/**
 * Tests for list artifacts handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listArtifactsHandler } from '../../../../src/handlers/artifacts/list-artifacts.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('listArtifactsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockCtx = {
      services: {},
    } as CommandContext;
  });

  it('should return empty list (stub implementation)', async () => {
    const args = {
      type: undefined,
      tags: undefined,
      format: 'table' as const,
    };

    const result = await listArtifactsHandler(args, mockCtx);

    expect(result).toEqual({
      artifacts: [],
      total: 0,
      filteredBy: args,
    });
  });

  it('should pass through filter arguments', async () => {
    const args = {
      type: 'strategy' as const,
      tags: ['production', 'tested'],
      format: 'json' as const,
    };

    const result = await listArtifactsHandler(args, mockCtx);

    expect(result.filteredBy).toEqual(args);
    expect(result.artifacts).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should handle undefined filters', async () => {
    const args = {
      type: undefined,
      tags: undefined,
      format: 'table' as const,
    };

    const result = await listArtifactsHandler(args, mockCtx);

    expect(result.filteredBy.type).toBeUndefined();
    expect(result.filteredBy.tags).toBeUndefined();
  });
});

