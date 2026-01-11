/**
 * Golden Path Tests for runSimulationDuckdb Workflow
 *
 * Tests the complete happy path for DuckDB-based simulation workflow.
 * These tests validate the entire orchestration flow from DuckDB query to simulation results.
 *
 * Golden Path:
 * 1. Query DuckDB for calls (batch mode) or use single mode
 * 2. Check OHLCV availability (resume mode)
 * 3. Filter calls by OHLCV availability
 * 4. Run simulation for each call
 * 5. Collect skipped tokens (if any)
 * 6. Trigger OHLCV ingestion for skipped tokens (if any)
 * 7. Update OHLCV metadata
 * 8. Re-run simulation for successfully ingested tokens
 * 9. Merge results
 * 10. Return structured, JSON-serializable result
 *
 * Tests use mocked WorkflowContext and validate orchestration behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';

// Mock dependencies BEFORE imports to prevent module resolution issues
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/utils')>('@quantbot/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ValidationError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
      }
    },
  };
});

vi.mock('@quantbot/backtest', () => ({
  DuckDBStorageService: vi.fn().mockImplementation(() => ({
    queryCalls: vi.fn(),
    checkOhlcvAvailability: vi.fn(),
    updateOhlcvMetadata: vi.fn(),
    markUnrecoverable: vi.fn(),
  })),
}));

// Now import after mocks are set up
import { runSimulationDuckdb } from '../../src/simulation/runSimulationDuckdb.js';
import type { RunSimulationDuckdbContext } from '../../src/simulation/runSimulationDuckdb.js';
import type { WorkflowContext } from '../../src/types.js';
import type { SimulationOutput } from '@quantbot/backtest';

describe('runSimulationDuckdb Workflow - Golden Path', () => {
  let mockContext: RunSimulationDuckdbContext;
  const TEST_DUCKDB_PATH = '/path/to/test.duckdb';
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });
  const TEST_ALERT_ISO = TEST_ALERT_TIME.toISO()!;

  const mockStrategy = {
    kind: 'simple',
    targets: [{ percent: 1.0, multiplier: 2.0 }],
    stopLoss: { initial: -0.3 },
  };

  const mockCandles = [
    {
      timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds()),
      open: 1.0,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 1000,
    },
    {
      timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 259 }).toSeconds()),
      open: 1.05,
      high: 1.15,
      low: 0.95,
      close: 1.1,
      volume: 2000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock context
    mockContext = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      clock: {
        now: () => DateTime.utc(),
      },
      ids: {
        generate: () => 'test-id-1',
      },
      services: {
        simulation: {
          runSimulation: vi.fn(),
        },
        duckdbStorage: {
          queryCalls: vi.fn(),
          checkOhlcvAvailability: vi.fn(),
          updateOhlcvMetadata: vi.fn(),
          markUnrecoverable: vi.fn(),
        },
        ohlcvIngestion: {
          ingestForCalls: vi.fn(),
        },
      },
    } as any;
  });

  describe('GOLDEN: Complete simulation flow - batch mode', () => {
    it('should complete full golden path: query → check OHLCV → simulate → return results', async () => {
      // Setup: DuckDB returns calls
      const mockCalls = [
        {
          mint: TEST_MINT,
          alert_timestamp: TEST_ALERT_ISO,
        },
        {
          mint: '8pXs123456789012345678901234567890pump',
          alert_timestamp: TEST_ALERT_ISO,
        },
      ];

      mockContext.services.duckdbStorage.queryCalls = vi.fn().mockResolvedValue({
        success: true,
        calls: mockCalls,
      });

      // Setup: OHLCV available for all calls
      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi.fn().mockResolvedValue(true);

      // Setup: Simulation succeeds
      const mockSimResult: SimulationOutput = {
        results: [
          {
            run_id: 'test-run-1',
            final_capital: 115,
            total_return_pct: 15,
            total_trades: 1,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
          {
            run_id: 'test-run-2',
            final_capital: 120,
            total_return_pct: 20,
            total_trades: 1,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
        ],
        summary: {
          total_runs: 2,
          successful: 2,
          failed: 0,
        },
      };

      mockContext.services.simulation.runSimulation = vi.fn().mockResolvedValue(mockSimResult);

      // Execute: Run workflow
      const result = await runSimulationDuckdb(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          strategy: mockStrategy,
          initialCapital: 100,
          lookbackMinutes: 260,
          lookforwardMinutes: 1440,
          batch: true,
          resume: true,
          errorMode: 'collect',
          maxRetries: 1,
          callsLimit: 1000,
        },
        mockContext
      );

      // Assert: Complete result structure (JSON-serializable)
      expect(result.success).toBe(true);
      expect(result.callsQueried).toBe(2);
      expect(result.callsSimulated).toBe(2);
      expect(result.callsSucceeded).toBe(2);
      expect(result.callsFailed).toBe(0);
      expect(result.skippedTokens).toEqual([]);
      expect(result.simulationResults).toBeDefined();
      expect(result.simulationResults.results.length).toBe(2);
      expect(result.startedAtISO).toBeDefined();
      expect(result.completedAtISO).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);

      // Assert: DuckDB queried
      expect(mockContext.services.duckdbStorage.queryCalls).toHaveBeenCalledWith(
        TEST_DUCKDB_PATH,
        1000
      );

      // Assert: OHLCV checked for each call
      expect(mockContext.services.duckdbStorage.checkOhlcvAvailability).toHaveBeenCalledTimes(2);

      // Assert: Simulation run once with all calls batched
      expect(mockContext.services.simulation.runSimulation).toHaveBeenCalledTimes(1);

      // Assert: Result is JSON-serializable
      const jsonString = JSON.stringify(result);
      const parsed = JSON.parse(jsonString);
      expect(parsed).toEqual(result);
    });

    it('should handle skipped tokens and trigger OHLCV ingestion', async () => {
      const mockCalls = [
        {
          mint: TEST_MINT,
          alert_timestamp: TEST_ALERT_ISO,
        },
        {
          mint: 'skipMint',
          alert_timestamp: TEST_ALERT_ISO,
        },
      ];

      mockContext.services.duckdbStorage.queryCalls = vi.fn().mockResolvedValue({
        success: true,
        calls: mockCalls,
      });

      // Setup: First call has OHLCV, second doesn't
      // Note: checkOhlcvAvailability returns boolean, not an object
      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi
        .fn()
        .mockResolvedValueOnce(true) // First call has OHLCV
        .mockResolvedValueOnce(false); // Second call doesn't have OHLCV

      // Setup: Simulation result for the first call only (second was skipped)
      const mockSimResult: SimulationOutput = {
        results: [
          {
            run_id: 'test-run-1',
            final_capital: 115,
            total_return_pct: 15,
            total_trades: 0,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
        ],
        summary: {
          total_runs: 1,
          successful: 1,
          failed: 0,
        },
      };

      mockContext.services.simulation.runSimulation = vi.fn().mockResolvedValue(mockSimResult);

      // Setup: OHLCV ingestion succeeds
      mockContext.services.ohlcvIngestion.ingestForCalls = vi.fn().mockResolvedValue({
        tokensProcessed: 1,
        tokensSucceeded: 1,
        tokensFailed: 0,
        tokensSkipped: 0,
        candlesFetched1m: 100,
        candlesFetched5m: 200,
        chunksFromCache: 0,
        chunksFromAPI: 2,
        errors: [],
      });

      // Setup: After ingestion, OHLCV is available (for retry check)
      // Note: checkOhlcvAvailability returns boolean, not an object
      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi
        .fn()
        .mockResolvedValueOnce(true); // After ingestion, OHLCV is available

      const result = await runSimulationDuckdb(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          strategy: mockStrategy,
          batch: true,
          resume: true,
          errorMode: 'collect',
          maxRetries: 1,
          callsLimit: 1000,
        },
        mockContext
      );

      // Assert: Skipped token collected
      expect(result.skippedTokens.length).toBeGreaterThan(0);

      // Assert: OHLCV ingestion triggered
      expect(mockContext.services.ohlcvIngestion.ingestForCalls).toHaveBeenCalled();

      // Assert: Re-simulation attempted for retry tokens
      expect(mockContext.services.simulation.runSimulation).toHaveBeenCalled();
    });
  });

  describe('GOLDEN: Single mode - mint and alert timestamp', () => {
    it('should complete golden path for single call mode', async () => {
      // Setup: OHLCV available
      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi.fn().mockResolvedValue(true);

      const mockSimResult: SimulationOutput = {
        results: [
          {
            run_id: 'test-run-1',
            final_capital: 120,
            total_return_pct: 20,
            total_trades: 0,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
        ],
        summary: {
          total_runs: 1,
          successful: 1,
          failed: 0,
        },
      };

      mockContext.services.simulation.runSimulation = vi.fn().mockResolvedValue(mockSimResult);

      const result = await runSimulationDuckdb(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          strategy: mockStrategy,
          mint: TEST_MINT,
          alertTimestamp: TEST_ALERT_ISO,
          batch: false,
          resume: true,
          errorMode: 'collect',
          maxRetries: 1,
          callsLimit: 1000,
        },
        mockContext
      );

      // Assert: Single call simulated
      expect(result.callsQueried).toBe(1); // Set to 1 in single mode (even though not actually queried from DB)
      expect(result.callsSimulated).toBe(1);
      expect(result.callsSucceeded).toBe(1);

      // Note: OHLCV availability is not checked in single mode (only in batch mode with resume=true)
      // The simulation service handles OHLCV checking internally
    });
  });

  describe('GOLDEN: Error handling - collect mode', () => {
    it('should collect per-call errors and continue processing', async () => {
      const mockCalls = [
        {
          mint: TEST_MINT,
          alert_timestamp: TEST_ALERT_ISO,
        },
        {
          mint: 'failMint',
          alert_timestamp: TEST_ALERT_ISO,
        },
        {
          mint: 'successMint',
          alert_timestamp: TEST_ALERT_ISO,
        },
      ];

      mockContext.services.duckdbStorage.queryCalls = vi.fn().mockResolvedValue({
        success: true,
        calls: mockCalls,
      });

      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi.fn().mockResolvedValue(true);

      // Setup: Simulation result with 2 successful and 1 failed (batched call)
      const mockSimResult: SimulationOutput = {
        results: [
          {
            run_id: 'test-run-1',
            final_capital: 115,
            total_return_pct: 15,
            total_trades: 0,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
          {
            run_id: 'test-run-2',
            error: 'Simulation error',
            mint: 'failMint',
            alert_timestamp: TEST_ALERT_ISO,
          },
          {
            run_id: 'test-run-3',
            final_capital: 120,
            total_return_pct: 20,
            total_trades: 0,
            mint: 'successMint',
            alert_timestamp: TEST_ALERT_ISO,
          },
        ],
        summary: {
          total_runs: 3,
          successful: 2,
          failed: 1,
        },
      };

      // Simulation is called once with all calls batched
      mockContext.services.simulation.runSimulation = vi.fn().mockResolvedValue(mockSimResult);

      const result = await runSimulationDuckdb(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          strategy: mockStrategy,
          batch: true,
          resume: false,
          errorMode: 'collect',
          maxRetries: 1,
          callsLimit: 1000,
        },
        mockContext
      );

      // Assert: Errors collected, processing continued
      expect(result.callsSimulated).toBe(3);
      expect(result.callsSucceeded).toBe(2);
      expect(result.callsFailed).toBe(1);
    });
  });

  describe('GOLDEN: Resume mode - OHLCV filtering', () => {
    it('should skip calls without OHLCV in resume mode', async () => {
      const mockCalls = [
        {
          mint: TEST_MINT,
          alert_timestamp: TEST_ALERT_ISO,
        },
        {
          mint: 'noOhlcvMint',
          alert_timestamp: TEST_ALERT_ISO,
        },
      ];

      mockContext.services.duckdbStorage.queryCalls = vi.fn().mockResolvedValue({
        success: true,
        calls: mockCalls,
      });

      // Setup: First has OHLCV, second doesn't
      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const mockSimResult: SimulationOutput = {
        results: [
          {
            run_id: 'test-run-1',
            final_capital: 115,
            total_return_pct: 15,
            total_trades: 0,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
        ],
        summary: {
          total_runs: 1,
          successful: 1,
          failed: 0,
        },
      };

      mockContext.services.simulation.runSimulation = vi.fn().mockResolvedValue(mockSimResult);

      const result = await runSimulationDuckdb(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          strategy: mockStrategy,
          batch: true,
          resume: true, // Resume mode enabled
          errorMode: 'collect',
          maxRetries: 1,
          callsLimit: 1000,
        },
        mockContext
      );

      // Assert: Only call with OHLCV simulated
      expect(result.callsSimulated).toBe(1);
      expect(result.callsSucceeded).toBe(1);
      expect(mockContext.services.simulation.runSimulation).toHaveBeenCalledTimes(1);
    });
  });

  describe('GOLDEN: Result serialization - JSON-safe', () => {
    it('should return JSON-serializable result (no Date objects, no class instances)', async () => {
      const mockCalls = [
        {
          mint: TEST_MINT,
          alert_timestamp: TEST_ALERT_ISO,
        },
      ];

      mockContext.services.duckdbStorage.queryCalls = vi.fn().mockResolvedValue({
        success: true,
        calls: mockCalls,
      });

      mockContext.services.duckdbStorage.checkOhlcvAvailability = vi.fn().mockResolvedValue(true);

      const mockSimResult: SimulationOutput = {
        results: [
          {
            run_id: 'test-run-1',
            final_capital: 115,
            total_return_pct: 15,
            total_trades: 0,
            mint: TEST_MINT,
            alert_timestamp: TEST_ALERT_ISO,
          },
        ],
        summary: {
          total_runs: 1,
          successful: 1,
          failed: 0,
        },
      };

      mockContext.services.simulation.runSimulation = vi.fn().mockResolvedValue(mockSimResult);

      const result = await runSimulationDuckdb(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          strategy: mockStrategy,
          batch: true,
          resume: false,
          errorMode: 'collect',
          maxRetries: 1,
          callsLimit: 1000,
        },
        mockContext
      );

      // Assert: Can serialize to JSON
      const jsonString = JSON.stringify(result);
      expect(jsonString).toBeDefined();

      // Assert: Can parse back
      const parsed = JSON.parse(jsonString);
      expect(parsed).toEqual(result);

      // Assert: No Date objects (all ISO strings)
      expect(typeof parsed.startedAtISO).toBe('string');
      expect(typeof parsed.completedAtISO).toBe('string');
      expect(parsed.startedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });
  });
});
