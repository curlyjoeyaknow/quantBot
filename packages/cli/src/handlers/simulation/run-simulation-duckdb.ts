/**
 * Handler for running DuckDB-based simulations.
 * Uses SimulationService to run simulations.
 *
 * Handler Flow (Canonical Pipeline):
 * 1. Command layer: Defines options, calls execute()
 * 2. execute(): Validates input, creates context, calls handler
 * 3. Handler (this file): Normalizes types, calls services, returns data
 * 4. Services: IO boundary (DuckDB, Python tools)
 * 5. Format/Render: execute() handles output formatting
 *
 * OHLCV Data Flow:
 * - Python simulator reads OHLCV from DuckDB `ohlcv_candles_d` table
 * - Falls back to `user_calls_d` for price data if candles not found
 * - Does NOT fetch from Birdeye API (that's the OHLCV ingestion job's responsibility)
 * - OHLCV ingestion should be run before simulation to ensure data availability
 */

import type { CommandContext } from '../../core/command-context.js';
import { ValidationError, logger } from '@quantbot/utils';
import {
  runSimulationDuckdbSchema,
  type RunSimulationDuckdbArgs,
} from '../../command-defs/simulation.js';
import type { SimulationConfig, SimulationResult } from '@quantbot/simulation';
import { addToQueue } from '../../core/ohlcv-queue.js';
import type { IngestForCallsResult } from '@quantbot/ingestion';

/**
 * Skipped token with timeframe requirements
 */
interface SkippedToken {
  mint: string;
  alertTimestamp: string;
  lookbackMinutes: number;
  lookforwardMinutes: number;
  reason: string;
}

// Re-export schema for convenience
export { runSimulationDuckdbSchema };
export type { RunSimulationDuckdbArgs };

/**
 * Handler function: pure use-case orchestration
 * - Normalizes types (ISO strings → Date)
 * - Chooses defaults
 * - Calls domain services (ctx.services.*)
 * - Returns plain data result (no printing)
 *
 * Handler must NOT:
 * - Parse argv (that's the command)
 * - Read env directly (use ctx/config)
 * - Access DB clients directly (use services)
 * - Spawn subprocesses directly (use PythonEngine service)
 */
export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbArgs,
  ctx: CommandContext
) {
  const service = ctx.services.simulation();
  const duckdbService = ctx.services.duckdbStorage();
  const ohlcvIngestionService = ctx.services.ohlcvIngestion();

  // Track loop iteration to prevent infinite loops (max 1 retry)
  let loopIteration = 0;
  const maxLoops = 1;

  // Build config
  const config: SimulationConfig = {
    duckdb_path: args.duckdb,
    strategy: args.strategy,
    initial_capital: args.initial_capital,
    lookback_minutes: args.lookback_minutes,
    lookforward_minutes: args.lookforward_minutes,
    resume: args.resume,
  };

  if (args.batch) {
    config.batch = true;

    // Query DuckDB for calls to simulate
    const callsResult = await duckdbService.queryCalls(args.duckdb, 1000); // Default limit: 1000 calls

    if (!callsResult.success || !callsResult.calls || callsResult.calls.length === 0) {
      throw new ValidationError(
        callsResult.error || 'No calls found in DuckDB for batch simulation',
        {
          operation: 'run_simulation_duckdb',
          mode: 'batch',
          duckdbPath: args.duckdb,
        }
      );
    }

    // If resume mode, check OHLCV metadata before running
    if (args.resume) {
      const callsToSimulate: Array<{ mint: string; alert_timestamp: string }> = [];
      const skippedTokens: SkippedToken[] = [];

      for (const call of callsResult.calls) {
        // Calculate required time range
        const alertTime = new Date(call.alert_timestamp);
        const requiredStart = new Date(
          alertTime.getTime() - args.lookback_minutes * 60 * 1000
        ).toISOString();
        const requiredEnd = new Date(
          alertTime.getTime() + args.lookforward_minutes * 60 * 1000
        ).toISOString();

        // Check if OHLCV data is available (using 5m interval as default)
        const intervalSeconds = 300; // 5 minutes
        const available = await duckdbService.checkOhlcvAvailability(
          args.duckdb,
          call.mint,
          call.alert_timestamp,
          intervalSeconds,
          requiredStart,
          requiredEnd
        );

        if (available) {
          callsToSimulate.push(call);
        } else {
          skippedTokens.push({
            mint: call.mint,
            alertTimestamp: call.alert_timestamp,
            lookbackMinutes: args.lookback_minutes,
            lookforwardMinutes: args.lookforward_minutes,
            reason: 'Insufficient OHLCV data',
          });
        }
      }

      if (callsToSimulate.length === 0) {
        logger.warn('No calls have sufficient OHLCV data for simulation', {
          totalCalls: callsResult.calls.length,
          skipped: skippedTokens.length,
        });
      }

      // Update config with filtered calls
      config.mints = callsToSimulate.map((call) => call.mint);
      config.alert_timestamps = callsToSimulate.map((call) => call.alert_timestamp);
      config.skipTokens = skippedTokens.map((token) => ({
        mint: token.mint,
        alert_timestamp: token.alertTimestamp,
      }));
    } else {
      // Extract mints and alert timestamps for all calls
      config.mints = callsResult.calls.map(
        (call: { mint: string; alert_timestamp: string }) => call.mint
      );
      config.alert_timestamps = callsResult.calls.map(
        (call: { mint: string; alert_timestamp: string }) => call.alert_timestamp
      );
    }
  } else {
    if (!args.mint) {
      throw new ValidationError('mint is required for single simulation', {
        operation: 'run_simulation_duckdb',
        mode: 'single',
      });
    }
    config.mint = args.mint;
    config.alert_timestamp = args.alert_timestamp || new Date().toISOString();
  }

  // Run simulation
  const result = await service.runSimulation(config);

  // Track skipped tokens from simulation results
  const skippedTokens: SkippedToken[] = [];

  if (result.results) {
    for (const simResult of result.results) {
      // Check if simulation failed due to missing candles or was skipped
      if (
        (simResult.error && simResult.error.includes('No candles')) ||
        simResult.skipped === true
      ) {
        const mint = simResult.mint;
        const alertTimestamp = simResult.alert_timestamp;

        if (mint && alertTimestamp) {
          skippedTokens.push({
            mint,
            alertTimestamp,
            lookbackMinutes: simResult.lookback_minutes || args.lookback_minutes,
            lookforwardMinutes: simResult.lookforward_minutes || args.lookforward_minutes,
            reason: simResult.error || 'Insufficient data',
          });

          // Add to OHLCV queue with timeframe requirements
          await addToQueue(mint, alertTimestamp, {
            lookbackMinutes: simResult.lookback_minutes || args.lookback_minutes,
            lookforwardMinutes: simResult.lookforward_minutes || args.lookforward_minutes,
            preWindowMinutes: args.lookback_minutes,
            postWindowMinutes: args.lookforward_minutes,
          });
        }
      }
    }
  }

  // Retry loop: if tokens were skipped and not already looped, trigger OHLCV ingestion and re-run
  if (skippedTokens.length > 0 && loopIteration < maxLoops) {
    logger.info('Tokens skipped due to insufficient data, triggering OHLCV ingestion', {
      skippedCount: skippedTokens.length,
      loopIteration,
    });

    // Trigger OHLCV ingestion for skipped tokens
    const queueItems = skippedTokens.map((token) => ({
      mint: token.mint,
      alertTimestamp: token.alertTimestamp,
      lookbackMinutes: token.lookbackMinutes,
      lookforwardMinutes: token.lookforwardMinutes,
      preWindowMinutes: token.lookbackMinutes,
      postWindowMinutes: token.lookforwardMinutes,
    }));

    try {
      const ingestionResult: IngestForCallsResult = await ohlcvIngestionService.ingestForCalls({
        duckdbPath: args.duckdb,
        preWindowMinutes: args.lookback_minutes,
        postWindowMinutes: args.lookforward_minutes,
        queueItems: queueItems,
      });

      // Update metadata for successfully processed tokens
      const queueItemsProcessed = ingestionResult.queueItemsProcessed || [];
      for (const item of queueItemsProcessed) {
        // Calculate time range based on alert timestamp and windows
        const alertTime = new Date(item.alertTimestamp);
        const timeRangeStart = new Date(
          alertTime.getTime() - args.lookback_minutes * 60 * 1000
        ).toISOString();
        const timeRangeEnd = new Date(
          alertTime.getTime() + args.lookforward_minutes * 60 * 1000
        ).toISOString();

        // Update metadata (using 5m interval as default)
        await duckdbService.updateOhlcvMetadata(
          args.duckdb,
          item.mint,
          item.alertTimestamp,
          300, // 5 minutes in seconds
          timeRangeStart,
          timeRangeEnd,
          ingestionResult.candlesFetched5m || 0 // Use 5m candle count
        );
      }

      // Check for unrecoverable tokens
      const unrecoverable = ingestionResult.tokensUnrecoverable || [];
      if (unrecoverable.length > 0) {
        // Mark unrecoverable tokens in exclusion table
        for (const token of unrecoverable) {
          await duckdbService.addOhlcvExclusion(
            args.duckdb,
            token.mint,
            token.alertTimestamp,
            token.reason || 'OHLCV data unavailable'
          );
        }
      }

      // Re-run simulation for previously skipped tokens (excluding unrecoverable)
      const tokensToRetry = skippedTokens.filter(
        (token) =>
          !unrecoverable.some(
            (u) => u.mint === token.mint && u.alertTimestamp === token.alertTimestamp
          )
      );

      if (tokensToRetry.length > 0) {
        logger.info('Re-running simulation for previously skipped tokens', {
          retryCount: tokensToRetry.length,
        });

        const retryConfig: SimulationConfig = {
          ...config,
          mints: tokensToRetry.map((token) => token.mint),
          alert_timestamps: tokensToRetry.map((token) => token.alertTimestamp),
          resume: false, // Don't skip on retry, try to run
        };

        const retryResult = await service.runSimulation(retryConfig);

        // Merge retry results with original results
        if (retryResult.results) {
          // Replace failed results with retry results
          const resultMap = new Map<string, SimulationResult>();
          retryResult.results.forEach((r) => {
            if (r.mint && r.alert_timestamp) {
              resultMap.set(`${r.mint}:${r.alert_timestamp}`, r);
            }
          });

          result.results = result.results.map((r) => {
            if (r.mint && r.alert_timestamp) {
              const retry = resultMap.get(`${r.mint}:${r.alert_timestamp}`);
              return retry || r;
            }
            return r;
          });

          // Update summary
          result.summary = {
            total_runs: result.summary.total_runs,
            successful: result.results.filter((r) => !r.error && !r.skipped).length,
            failed: result.results.filter((r) => r.error || r.skipped).length,
          };
        }
      }

      loopIteration++;
    } catch (error) {
      logger.error('Failed to trigger OHLCV ingestion for skipped tokens', error as Error);
      // Continue with original results even if ingestion fails
    }
  }

  return result;
}
