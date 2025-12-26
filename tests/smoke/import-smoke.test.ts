/**
 * Import Smoke Test
 *
 * Quick validation that all public APIs can be imported.
 * This ensures package boundaries and exports are correct.
 */

import { describe, it, expect } from 'vitest';

describe('Import Smoke Test', () => {
  it('should import @quantbot/core', async () => {
    const core = await import('@quantbot/core');
    expect(core).toBeDefined();
  });

  it('should import @quantbot/utils', async () => {
    const utils = await import('@quantbot/utils');
    expect(utils).toBeDefined();
  });

  it('should import @quantbot/workflows', async () => {
    const workflows = await import('@quantbot/workflows');
    expect(workflows).toBeDefined();
  });

  it('should import @quantbot/simulation', async () => {
    const simulation = await import('@quantbot/simulation');
    expect(simulation).toBeDefined();
  });

  it('should import @quantbot/storage', async () => {
    const storage = await import('@quantbot/storage');
    expect(storage).toBeDefined();
  });
});


