/**
 * BaselineBacktestService Integration Tests
 *
 * Tests Python integration for baseline backtesting.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { BaselineBacktestService } from '../baseline-backtest-service.js';
import { PythonEngine } from '@quantbot/utils';
import { existsSync } from 'fs';
import { join } from 'path';

describe('BaselineBacktestService Integration', () => {
  let service: BaselineBacktestService;
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    pythonEngine = new PythonEngine();
    service = new BaselineBacktestService(pythonEngine);
  });

  it('should have Python scripts in correct location', () => {
    const workspaceRoot = process.cwd();
    const runBaselineScript = join(
      workspaceRoot,
      'packages/backtest/python/scripts/run_baseline.py'
    );
    const runFastBacktestScript = join(
      workspaceRoot,
      'packages/backtest/python/scripts/run_fast_backtest.py'
    );

    expect(existsSync(runBaselineScript)).toBe(true);
    expect(existsSync(runFastBacktestScript)).toBe(true);
  });

  it('should have shared utilities in correct location', () => {
    const workspaceRoot = process.cwd();
    const duckdbAdapter = join(
      workspaceRoot,
      'packages/backtest/python/shared/duckdb_adapter.py'
    );

    expect(existsSync(duckdbAdapter)).toBe(true);
  });

  it('should have library modules in correct location', () => {
    const workspaceRoot = process.cwd();
    const v1BaselineSimulator = join(
      workspaceRoot,
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    expect(existsSync(v1BaselineSimulator)).toBe(true);
  });

  // Note: Full end-to-end tests require DuckDB fixture and ClickHouse
  // These are smoke tests to verify service wiring
});

