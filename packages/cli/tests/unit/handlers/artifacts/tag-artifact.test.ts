/**
 * Tests for tag artifact handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tagArtifactHandler } from '../../../../src/handlers/artifacts/tag-artifact.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('tagArtifactHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockCtx = {
      services: {},
    } as CommandContext;
  });

  it('should return success with tags (stub implementation)', async () => {
    const args = {
      id: 'strategy-123',
      version: '2.0.0',
      tags: ['production', 'tested'],
    };

    const result = await tagArtifactHandler(args, mockCtx);

    expect(result).toEqual({
      success: true,
      artifactId: 'strategy-123',
      version: '2.0.0',
      tags: ['production', 'tested'],
    });
  });

  it('should handle single tag', async () => {
    const args = {
      id: 'strategy-123',
      version: '1.0.0',
      tags: ['production'],
    };

    const result = await tagArtifactHandler(args, mockCtx);

    expect(result.success).toBe(true);
    expect(result.tags).toEqual(['production']);
  });

  it('should handle multiple tags', async () => {
    const args = {
      id: 'strategy-123',
      version: '2.0.0',
      tags: ['production', 'tested', 'v2'],
    };

    const result = await tagArtifactHandler(args, mockCtx);

    expect(result.tags).toEqual(['production', 'tested', 'v2']);
  });
});

