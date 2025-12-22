/**
 * Tests for DuckDB simulation handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSimulationDuckdbHandler } from '../../../../src/handlers/simulation/run-simulation-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { ValidationError, AppError } from '@quantbot/utils';
import type { SimulationService } from '@quantbot/simulation';

// Mock workflows
const mockCreateDuckdbSimulationContext = vi.fn();
const mockRunSimulationDuckdb = vi.fn();
vi.mock('@quantbot/workflows', () => ({
  createDuckdbSimulationContext: (...args: unknown[]) => mockCreateDuckdbSimulationContext(...args),
  runSimulationDuckdb: (...args: unknown[]) => mockRunSimulationDuckdb(...args),
}));

// Mock jobs - OhlcvBirdeyeFetch must be a constructor
vi.mock('@quantbot/jobs', () => ({
  OhlcvBirdeyeFetch: vi.fn().mockImplementation(function OhlcvBirdeyeFetch() {
    return {};
  }),
}));

describe('runSimulationDuckdbHandler', () => {
  let mockCtx: CommandContext;
  let mockService: SimulationService;

  beforeEach(() => {
    mockService = {
      runSimulation: vi.fn(),
    } as unknown as SimulationService;

    mockCtx = {
      services: {
        simulation: () => mockService,
        duckdbStorage: () => ({
          storeRun: vi.fn(),
        }),
        ohlcvIngestion: () => ({
          ingestForCalls: vi.fn(),
        }),
      },
    } as unknown as CommandContext;

    mockCreateDuckdbSimulationContext.mockReturnValue({
      simulation: {
        runSimulation: mockService.runSimulation,
      },
    } as any);

    mockRunSimulationDuckdb.mockImplementation(async (spec, ctx) => {
      // Call the actual service's runSimulation method
      const result = await mockService.runSimulation({
        duckdb_path: spec.duckdbPath,
        strategy: spec.strategy,
        initial_capital: spec.initialCapital,
        lookback_minutes: spec.lookbackMinutes,
        lookforward_minutes: spec.lookforwardMinutes,
        mint: spec.mint,
        alert_timestamp: spec.alertTimestamp,
      });
      return {
        simulationResults: result,
      };
    });

    vi.clearAllMocks();
  });

  it('should call service with correct config', async () => {
    const mockResult = {
      results: [
        {
          run_id: 'test-run-id',
          final_capital: 1200.0,
          total_return_pct: 20.0,
          total_trades: 1,
        },
      ],
      summary: {
        total_runs: 1,
        successful: 1,
        failed: 0,
      },
    };

    vi.mocked(mockService.runSimulation).mockResolvedValue(mockResult);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: {
        strategy_id: 'test_strategy',
        name: 'Test Strategy',
        entry_type: 'immediate' as const,
        profit_targets: [{ target: 2.0, percent: 0.5 }],
        stop_loss_pct: 0.2,
      },
      mint: 'So11111111111111111111111111111111111111112',
      alert_timestamp: '2024-01-01T12:00:00Z',
      batch: false,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
    };

    const result = await runSimulationDuckdbHandler(args, mockCtx);

    expect(mockRunSimulationDuckdb).toHaveBeenCalledTimes(1);
    expect(mockService.runSimulation).toHaveBeenCalledWith({
      duckdb_path: '/path/to/tele.duckdb',
      strategy: args.strategy,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
      mint: 'So11111111111111111111111111111111111111112',
      alert_timestamp: '2024-01-01T12:00:00Z',
    });

    // Handler returns result.simulationResults (from workflow)
    expect(result).toHaveProperty('results');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toHaveProperty('run_id');
  });

  it('should throw ValidationError if mint is missing in single mode', async () => {
    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: {
        strategy_id: 'test_strategy',
        name: 'Test Strategy',
        entry_type: 'immediate' as const,
        profit_targets: [],
      },
      batch: false,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
    };

    // Mock workflow to throw ValidationError for missing mint
    const validationError = new ValidationError('mint is required when batch is false', {
      mint: undefined,
      batch: false,
    });
    mockRunSimulationDuckdb.mockRejectedValue(validationError);

    await expect(runSimulationDuckdbHandler(args as any, mockCtx)).rejects.toThrow(ValidationError);
    await expect(runSimulationDuckdbHandler(args as any, mockCtx)).rejects.toThrow(
      'mint is required'
    );
  });

  it('should propagate service errors', async () => {
    const error = new AppError('Simulation failed', 'SIMULATION_FAILED', 500);
    mockRunSimulationDuckdb.mockRejectedValue(error);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: {
        strategy_id: 'test_strategy',
        name: 'Test Strategy',
        entry_type: 'immediate' as const,
        profit_targets: [],
      },
      mint: 'So11111111111111111111111111111111111111112',
      batch: false,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
    };

    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow(AppError);
    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow('Simulation failed');
  });
});
