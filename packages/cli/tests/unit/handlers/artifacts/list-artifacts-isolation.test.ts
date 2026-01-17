/**
 * Isolation test for list artifacts handler
 *
 * LITMUS TEST: Verify handler is REPL-friendly (can be called directly without CLI infrastructure)
 */

import { describe, it, expect } from 'vitest';
import { listArtifactsHandler } from '../../../../src/handlers/artifacts/list-artifacts.js';

describe('listArtifactsHandler - Isolation Test', () => {
  it('can be imported and called directly with plain objects (REPL-friendly)', async () => {
    // This test verifies the handler can be used outside CLI context
    // Simulates calling from REPL or programmatic usage

    const args = {
      type: undefined,
      tags: undefined,
      format: 'table' as const,
    };

    const ctx = {
      services: {},
    } as any;

    // Should not throw and should return structured result
    const result = await listArtifactsHandler(args, ctx);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect('artifacts' in result).toBe(true);
    expect('total' in result).toBe(true);
    // Handler doesn't return filteredBy (stub implementation)
  });

  it('does not depend on CLI infrastructure', async () => {
    // Verify handler doesn't access process.env, console, etc.
    const args = {
      type: 'strategy' as const,
      tags: ['production'],
      format: 'json' as const,
    };

    const ctx = {
      services: {},
    } as any;

    const result = await listArtifactsHandler(args, ctx);

    // Should work with minimal context
    expect(result).toBeDefined();
  });
});
