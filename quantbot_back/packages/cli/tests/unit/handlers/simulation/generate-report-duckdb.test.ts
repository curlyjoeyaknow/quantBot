/**
 * Unit tests for generate-report-duckdb handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReportDuckdbHandler } from '../../../../src/commands/simulation/generate-report-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('generateReportDuckdbHandler', () => {
  let mockDuckDBStorage: { generateReport: ReturnType<typeof vi.fn> };
  let mockCtx: CommandContext;

  beforeEach(() => {
    // Mock DuckDBStorageService
    mockDuckDBStorage = {
      generateReport: vi.fn(),
    };

    mockCtx = {
      services: {
        duckdbStorage: () => mockDuckDBStorage as any,
      },
    } as unknown as CommandContext;
  });

  it('should generate summary report', async () => {
    vi.mocked(mockDuckDBStorage.generateReport).mockResolvedValue({
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

    expect(mockDuckDBStorage.generateReport).toHaveBeenCalledWith(
      '/path/to/sim.duckdb',
      'summary',
      undefined
    );
    expect(result.success).toBe(true);
    expect(result.report_type).toBe('summary');
  });

  it('should generate strategy performance report', async () => {
    vi.mocked(mockDuckDBStorage.generateReport).mockResolvedValue({
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

    expect(mockDuckDBStorage.generateReport).toHaveBeenCalledWith(
      '/path/to/sim.duckdb',
      'strategy_performance',
      'PT2_SL25'
    );
    expect(result.success).toBe(true);
    expect(result.report_type).toBe('strategy_performance');
  });
});
