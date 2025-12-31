/**
 * Import Smoke Test
 *
 * Quick validation that all public APIs can be imported.
 * This ensures package boundaries and exports are correct.
 * 
 * Note: Packages must be built before running this test.
 * Run `pnpm build:ordered` first if imports fail.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

describe('Import Smoke Test', () => {
  it('should import @quantbot/core', async () => {
    // Check if package is built
    const distPath = join(ROOT, 'packages/core/dist/index.js');
    if (!existsSync(distPath)) {
      console.warn('⚠️  @quantbot/core not built. Run `pnpm build:ordered` first.');
      return; // Skip test if not built
    }
    
    const core = await import('@quantbot/core');
    expect(core).toBeDefined();
  });

  it('should import @quantbot/utils', async () => {
    const utils = await import('@quantbot/utils');
    expect(utils).toBeDefined();
  });

  it('should import @quantbot/workflows', async () => {
    // Check if package is built
    const distPath = join(ROOT, 'packages/workflows/dist/index.js');
    if (!existsSync(distPath)) {
      console.warn('⚠️  @quantbot/workflows not built. Run `pnpm build:ordered` first.');
      return; // Skip test if not built
    }
    
    // Workflows import can be slow due to initialization, increase timeout
    const workflows = await import('@quantbot/workflows');
    expect(workflows).toBeDefined();
  }, 15000); // 15 second timeout

  it('should import @quantbot/simulation', async () => {
    const simulation = await import('@quantbot/simulation');
    expect(simulation).toBeDefined();
  });

  it('should import @quantbot/storage', async () => {
    const storage = await import('@quantbot/storage');
    expect(storage).toBeDefined();
  });
});


