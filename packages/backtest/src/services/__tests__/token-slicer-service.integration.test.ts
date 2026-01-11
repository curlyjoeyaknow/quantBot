/**
 * TokenSlicerService Integration Tests
 *
 * Tests Python integration for token slice export.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TokenSlicerService } from '../token-slicer-service.js';
import { PythonEngine } from '@quantbot/utils';
import { existsSync } from 'fs';
import { join } from 'path';

describe('TokenSlicerService Integration', () => {
  let service: TokenSlicerService;
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    pythonEngine = new PythonEngine();
    service = new TokenSlicerService(pythonEngine);
  });

  it('should have Python script in correct location', () => {
    const workspaceRoot = process.cwd();
    const tokenSlicerScript = join(
      workspaceRoot,
      'packages/backtest/python/scripts/token_slicer.py'
    );

    expect(existsSync(tokenSlicerScript)).toBe(true);
  });

  // Note: Full end-to-end tests require ClickHouse connection
  // These are smoke tests to verify service wiring
});
