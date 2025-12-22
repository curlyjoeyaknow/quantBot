/**
 * Isolation test for get artifact handler
 * 
 * LITMUS TEST: Verify handler is REPL-friendly
 */

import { describe, it, expect } from 'vitest';
import { getArtifactHandler } from '../../../../src/handlers/artifacts/get-artifact.js';

describe('getArtifactHandler - Isolation Test', () => {
  it('can be imported and called directly with plain objects (REPL-friendly)', async () => {
    const args = {
      id: 'strategy-123',
      version: undefined,
      format: 'table' as const,
    };

    const ctx = {
      services: {},
    } as any;

    const result = await getArtifactHandler(args, ctx);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect('artifact' in result).toBe(true);
    expect('found' in result).toBe(true);
  });

  it('does not depend on CLI infrastructure', async () => {
    const args = {
      id: 'strategy-123',
      version: '2.0.0',
      format: 'json' as const,
    };

    const ctx = {
      services: {},
    } as any;

    const result = await getArtifactHandler(args, ctx);

    expect(result).toBeDefined();
  });
});

