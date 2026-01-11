/**
 * Isolation test for tag artifact handler
 *
 * LITMUS TEST: Verify handler is REPL-friendly
 */

import { describe, it, expect } from 'vitest';
import { tagArtifactHandler } from '../../../../src/handlers/artifacts/tag-artifact.js';

describe('tagArtifactHandler - Isolation Test', () => {
  it('can be imported and called directly with plain objects (REPL-friendly)', async () => {
    const args = {
      id: 'strategy-123',
      version: '2.0.0',
      tags: ['production', 'tested'],
    };

    const ctx = {
      services: {},
    } as any;

    const result = await tagArtifactHandler(args, ctx);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect('success' in result).toBe(true);
    expect('artifactId' in result).toBe(true);
    expect('version' in result).toBe(true);
    expect('tags' in result).toBe(true);
  });

  it('does not depend on CLI infrastructure', async () => {
    const args = {
      id: 'strategy-123',
      version: '1.0.0',
      tags: ['production'],
    };

    const ctx = {
      services: {},
    } as any;

    const result = await tagArtifactHandler(args, ctx);

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});
