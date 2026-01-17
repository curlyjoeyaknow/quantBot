/**
 * Tests for DuckDB simulation handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSimulationDuckdbHandler } from '../../../../src/commands/simulation/run-simulation-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { ValidationError, AppError } from '@quantbot/infra/utils';
import type { SimulationService } from '@quantbot/backtest';

// Mock workflows
const mockRunSimulationDuckdb = vi.fn();
const mockCreateDuckdbSimulationContext = vi.fn();
vi.mock('@quantbot/workflows', () => ({
  runSimulationDuckdb: (...args: unknown[]) => mockRunSimulationDuckdb(...args),
  createDuckdbSimulationContext: (...args: unknown[]) => mockCreateDuckdbSimulationContext(...args),
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

    const mockWorkflowContext = {
      simulation: {
        runSimulation: mockService.runSimulation,
      },
    } as any;

    // Mock createDuckdbSimulationContext to return the workflow context
    mockCreateDuckdbSimulationContext.mockResolvedValue(mockWorkflowContext);

    mockCtx = {
      services: {
        simulation: () => mockService,
        duckdbStorage: () => ({
          storeRun: vi.fn(),
        }),
        ohlcvIngestion: () => ({
          ingestForCalls: vi.fn(),
        }),
        workflowContext: () => mockWorkflowContext,
      },
    } as unknown as CommandContext;

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

    const strategyObj = {
      strategy_id: 'test_strategy',
      name: 'Test Strategy',
      entry_type: 'immediate' as const,
      profit_targets: [{ target: 2.0, percent: 0.5 }],
      stop_loss_pct: 0.2,
    };

    // Command handler expects strategy as object, it will convert to JSON string for pure handler
    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: strategyObj, // Command handler converts this to JSON string
      mint: 'So11111111111111111111111111111111111111112',
      alertTimestamp: '2024-01-01T12:00:00Z',
      batch: false,
      initialCapital: 1000.0,
      lookbackMinutes: 260,
      lookforwardMinutes: 1440,
    };

    const result = await runSimulationDuckdbHandler(args, mockCtx);

    expect(mockRunSimulationDuckdb).toHaveBeenCalledTimes(1);
    // Verify the workflow was called with the parsed strategy object
    const workflowCall = mockRunSimulationDuckdb.mock.calls[0];
    expect(workflowCall[0].strategy).toEqual(strategyObj);
    expect(workflowCall[0].duckdbPath).toBe('/path/to/tele.duckdb');
    expect(workflowCall[0].mint).toBe('So11111111111111111111111111111111111111112');
    expect(workflowCall[0].alertTimestamp).toBe('2024-01-01T12:00:00Z');

    // Handler returns result.simulationResults (from workflow)
    expect(result).toHaveProperty('results');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toHaveProperty('run_id');
  });

  it('should throw ValidationError if mint is missing in single mode', async () => {
    const strategyObj = {
      strategy_id: 'test_strategy',
      name: 'Test Strategy',
      entry_type: 'immediate' as const,
      profit_targets: [],
    };

    // Command handler expects strategy as object, it will convert to JSON string for pure handler
    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: strategyObj, // Command handler converts this to JSON string
      batch: false,
      initialCapital: 1000.0,
      lookbackMinutes: 260,
      lookforwardMinutes: 1440,
    };

    // Mock workflow to throw ValidationError for missing mint
    const validationError = new ValidationError('mint is required when batch is false', {
      mint: undefined,
      batch: false,
    });
    mockRunSimulationDuckdb.mockRejectedValue(validationError);

    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow('mint is required');
  });

  it('should propagate service errors', async () => {
    const error = new AppError('Simulation failed', 'SIMULATION_FAILED', 500);
    mockRunSimulationDuckdb.mockRejectedValue(error);

    const strategyObj = {
      strategy_id: 'test_strategy',
      name: 'Test Strategy',
      entry_type: 'immediate' as const,
      profit_targets: [],
    };

    // Command handler expects strategy as object, it will convert to JSON string for pure handler
    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: strategyObj, // Command handler converts this to JSON string
      mint: 'So11111111111111111111111111111111111111112',
      batch: false,
      initialCapital: 1000.0,
      lookbackMinutes: 260,
      lookforwardMinutes: 1440,
    };

    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow(AppError);
    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow('Simulation failed');
  });
});
