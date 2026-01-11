/**
 * CallerAnalysisService Integration Tests
 *
 * Tests Python integration for caller analysis.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CallerAnalysisService } from '../caller-analysis-service.js';
import { PythonEngine } from '@quantbot/utils';
import { existsSync } from 'fs';
import { join } from 'path';

describe('CallerAnalysisService Integration', () => {
  let service: CallerAnalysisService;
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    pythonEngine = new PythonEngine();
    service = new CallerAnalysisService(pythonEngine);
  });

  it('should have Python script in correct location', () => {
    const workspaceRoot = process.cwd();
    const callerAnalysisScript = join(
      workspaceRoot,
      'packages/backtest/python/scripts/run_caller_analysis.py'
    );

    expect(existsSync(callerAnalysisScript)).toBe(true);
  });

  // Note: Full end-to-end tests require DuckDB fixture with backtest results
  // These are smoke tests to verify service wiring
});
