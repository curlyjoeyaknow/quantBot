/**
 * Unit tests for generate-report-duckdb handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReportDuckdbHandler } from '../../../../src/handlers/simulation/generate-report-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import type { PythonEngine } from '@quantbot/utils';

describe('generateReportDuckdbHandler', () => {
  let mockEngine: PythonEngine;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockEngine = {
      runDuckDBStorage: vi.fn(),
    } as unknown as PythonEngine;

    mockCtx = {
      services: {
        pythonEngine: () => mockEngine,
      },
    } as unknown as CommandContext;
  });

  it('should generate summary report', async () => {
    vi.mocked(mockEngine.runDuckDBStorage).mockResolvedValue({
      success: true,
      report_type: 'summary',
      data: {
        total_runs: 100,
        avg_return_pct: 15.5,
        avg_sharpe_ratio: 1.2,
        avg_win_rate: 0.6,
        total_trades: 500,
        avg_drawdown_pct: 8.0,
      },
    });

    const args = {
      duckdb: '/path/to/sim.duckdb',
      type: 'summary' as const,
      format: 'table' as const,
    };

    const result = await generateReportDuckdbHandler(args, mockCtx);

    expect(mockEngine.runDuckDBStorage).toHaveBeenCalledWith({
      duckdbPath: '/path/to/sim.duckdb',
      operation: 'generate_report',
      data: {
        type: 'summary',
      },
    });
    expect(result.success).toBe(true);
    expect(result.report_type).toBe('summary');
  });

  it('should generate strategy performance report', async () => {
    vi.mocked(mockEngine.runDuckDBStorage).mockResolvedValue({
      success: true,
      report_type: 'strategy_performance',
      data: {
        strategy_id: 'PT2_SL25',
        run_count: 50,
        avg_return_pct: 18.0,
        avg_sharpe_ratio: 1.5,
        avg_win_rate: 0.65,
        total_trades: 250,
      },
    });

    const args = {
      duckdb: '/path/to/sim.duckdb',
      type: 'strategy_performance' as const,
      strategyId: 'PT2_SL25',
      format: 'table' as const,
    };

    const result = await generateReportDuckdbHandler(args, mockCtx);

    expect(mockEngine.runDuckDBStorage).toHaveBeenCalledWith({
      duckdbPath: '/path/to/sim.duckdb',
      operation: 'generate_report',
      data: {
        type: 'strategy_performance',
        strategy_id: 'PT2_SL25',
      },
    });
    expect(result.success).toBe(true);
    expect(result.report_type).toBe('strategy_performance');
  });
});
