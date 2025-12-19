/**
 * DuckDB Simulation Workflow
 * ===========================
 *
 * Orchestrates DuckDB-based simulation with automatic OHLCV ingestion retry:
 * 1. Query DuckDB for calls (batch mode)
 * 2. Check OHLCV availability (resume mode)
 * 3. Filter calls by OHLCV availability
 * 4. Run simulation (via simulation service)
 * 5. Collect skipped tokens
 * 6. If skipped tokens exist:
 *    - Trigger OHLCV ingestion workflow
 *    - Update OHLCV metadata
 *    - Mark unrecoverable tokens
 *    - Re-run simulation for retry tokens
 *    - Merge results
 * 7. Return structured, serializable results
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/utils';
import type { WorkflowContext } from '../types.js';
import type { SimulationConfig, SimulationOutput } from '@quantbot/simulation';

// SimulationResult from service layer (includes error/skipped fields)
type SimulationResult = {
  run_id?: string;
  final_capital?: number;
  total_return_pct?: number;
  total_trades?: number;
  error?: string;
  mint?: string;
  alert_timestamp?: string;
  skipped?: boolean;
  lookback_minutes?: number;
  lookforward_minutes?: number;
};
import type { IngestOhlcvSpec } from '../ohlcv/ingestOhlcv.js';
import type { IngestOhlcvContext } from '../ohlcv/ingestOhlcv.js';

/**
 * DuckDB Simulation Spec
 */
export const RunSimulationDuckdbSpecSchema = z.object({
  duckdbPath: z.string().min(1, 'duckdbPath is required'),
  strategy: z.record(z.string(), z.unknown()), // Strategy config object
  initialCapital: z.number().positive().optional(),
  lookbackMinutes: z.number().int().min(0).optional(),
  lookforwardMinutes: z.number().int().min(0).optional(),
  resume: z.boolean().optional().default(false),
  batch: z.boolean().optional().default(false),
  mint: z.string().optional(), // Single mode
  alertTimestamp: z.string().optional(), // Single mode (ISO date string)
  errorMode: z.enum(['collect', 'failFast']).optional().default('collect'),
  maxRetries: z.number().int().min(0).max(3).optional().default(1),
  callsLimit: z.number().int().min(1).max(10000).optional().default(1000), // For batch mode
});

export type RunSimulationDuckdbSpec = z.infer<typeof RunSimulationDuckdbSpecSchema>;

/**
 * Skipped token with timeframe requirements
 */
export type SkippedToken = {
  mint: string;
  alertTimestamp: string; // ISO date string
  lookbackMinutes: number;
  lookforwardMinutes: number;
  reason: string;
};

/**
 * DuckDB Simulation Result (JSON-serializable)
 */
export type RunSimulationDuckdbResult = {
  success: boolean;
  simulationResults: SimulationOutput;
  callsQueried: number;
  callsSimulated: number;
  callsSucceeded: number;
  callsFailed: number;
  callsSkipped: number;
  callsRetried: number;
  tokensIngested: number;
  tokensUnrecoverable: number;
  skippedTokens: SkippedToken[];
  retryAttempts: number;
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
};

/**
 * Extended WorkflowContext for DuckDB simulation
 */
export type RunSimulationDuckdbContext = WorkflowContext & {
  services: {
    simulation: {
      runSimulation: (config: SimulationConfig) => Promise<SimulationOutput>;
    };
    duckdbStorage: {
      queryCalls: (
        path: string,
        limit: number
      ) => Promise<{
        success: boolean;
        calls?: Array<{ mint: string; alert_timestamp: string }>;
        error?: string;
      }>;
      checkOhlcvAvailability: (
        path: string,
        mint: string,
        alertTimestamp: string,
        intervalSeconds: number,
        requiredStart: string,
        requiredEnd: string
      ) => Promise<boolean>;
      updateOhlcvMetadata: (
        path: string,
        mint: string,
        alertTimestamp: string,
        intervalSeconds: number,
        timeRangeStart: string,
        timeRangeEnd: string,
        candleCount: number
      ) => Promise<void>;
      addOhlcvExclusion: (
        path: string,
        mint: string,
        alertTimestamp: string,
        reason: string
      ) => Promise<void>;
    };
    ohlcvIngestion: {
      ingestForCalls: (params: {
        duckdbPath: string;
        preWindowMinutes: number;
        postWindowMinutes: number;
        queueItems?: Array<{
          mint: string;
          alertTimestamp: string;
          queuedAt: string;
        }>;
        [key: string]: unknown; // Allow additional params
      }) => Promise<{
        tokensProcessed: number;
        tokensSucceeded: number;
        tokensFailed: number;
        tokensSkipped: number;
        tokensUnrecoverable?: Array<{
          mint: string;
          alertTimestamp: string;
          reason: string;
        }>;
        queueItemsProcessed?: Array<{ mint: string; alertTimestamp: string }>;
        candlesFetched5m: number;
      }>;
    };
  };
  ohlcvIngestion: IngestOhlcvContext['jobs']; // For calling ingestOhlcv workflow
};

/**
 * Create default context (for testing)
 */
export function createDefaultRunSimulationDuckdbContext(): RunSimulationDuckdbContext {
  throw new Error(
    'createDefaultRunSimulationDuckdbContext must be implemented with actual services'
  );
}

/**
 * DuckDB Simulation Workflow
 *
 * Follows workflow contract:
 * - Validates spec (Zod schema)
 * - Uses WorkflowContext (DI) - all dependencies via context
 * - Returns JSON-serializable result (ISO strings, no Date objects)
 * - Explicit error policy (collect vs failFast)
 * - Default parameter pattern for ctx (for testing convenience)
 */
export async function runSimulationDuckdb(
  spec: RunSimulationDuckdbSpec,
  ctx: RunSimulationDuckdbContext = createDefaultRunSimulationDuckdbContext()
): Promise<RunSimulationDuckdbResult> {
  const startedAt = DateTime.utc();
  const startedAtISO = startedAt.toISO()!;

  // 1. Validate spec
  const parsed = RunSimulationDuckdbSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid DuckDB simulation spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;
  const errorMode = validated.errorMode ?? 'collect';
  const maxRetries = validated.maxRetries ?? 1;

  ctx.logger.info('Starting DuckDB simulation workflow', {
    duckdbPath: validated.duckdbPath,
    batch: validated.batch,
    resume: validated.resume,
    strategy: Object.keys(validated.strategy),
  });

  // 2. Build simulation config
  const config: SimulationConfig = {
    duckdb_path: validated.duckdbPath,
    strategy: validated.strategy,
    initial_capital: validated.initialCapital,
    lookback_minutes: validated.lookbackMinutes,
    lookforward_minutes: validated.lookforwardMinutes,
    resume: validated.resume,
    batch: validated.batch,
  };

  let callsQueried = 0;
  let callsToSimulate: Array<{ mint: string; alert_timestamp: string }> = [];
  const initialSkippedTokens: SkippedToken[] = [];

  // 3. Query DuckDB for calls (batch mode) or use single mode
  if (validated.batch) {
    const callsResult = await ctx.services.duckdbStorage.queryCalls(
      validated.duckdbPath,
      validated.callsLimit ?? 1000
    );

    if (!callsResult.success || !callsResult.calls || callsResult.calls.length === 0) {
      const errorMessage = callsResult.error || 'No calls found in DuckDB for batch simulation';
      ctx.logger.error('Failed to query calls from DuckDB', { error: errorMessage });
      if (errorMode === 'failFast') {
        throw new ValidationError(errorMessage, {
          operation: 'run_simulation_duckdb',
          mode: 'batch',
          duckdbPath: validated.duckdbPath,
        });
      }
      return {
        success: false,
        simulationResults: {
          results: [],
          summary: { total_runs: 0, successful: 0, failed: 0 },
        },
        callsQueried: 0,
        callsSimulated: 0,
        callsSucceeded: 0,
        callsFailed: 0,
        callsSkipped: 0,
        callsRetried: 0,
        tokensIngested: 0,
        tokensUnrecoverable: 0,
        skippedTokens: [],
        retryAttempts: 0,
        startedAtISO,
        completedAtISO: DateTime.utc().toISO()!,
        durationMs: DateTime.utc().diff(startedAt, 'milliseconds').milliseconds,
      };
    }

    callsQueried = callsResult.calls.length;

    // 4. Check OHLCV availability (resume mode)
    if (validated.resume) {
      for (const call of callsResult.calls) {
        const alertTime = DateTime.fromISO(call.alert_timestamp);
        if (!alertTime.isValid) {
          ctx.logger.warn('Invalid alert timestamp in call', {
            mint: call.mint.substring(0, 20),
            alertTimestamp: call.alert_timestamp,
          });
          continue;
        }

        const requiredStart = alertTime.minus({ minutes: validated.lookbackMinutes ?? 0 }).toISO()!;
        const requiredEnd = alertTime.plus({ minutes: validated.lookforwardMinutes ?? 0 }).toISO()!;

        const available = await ctx.services.duckdbStorage.checkOhlcvAvailability(
          validated.duckdbPath,
          call.mint,
          call.alert_timestamp,
          300, // 5 minutes in seconds
          requiredStart,
          requiredEnd
        );

        if (available) {
          callsToSimulate.push(call);
        } else {
          initialSkippedTokens.push({
            mint: call.mint,
            alertTimestamp: call.alert_timestamp,
            lookbackMinutes: validated.lookbackMinutes ?? 0,
            lookforwardMinutes: validated.lookforwardMinutes ?? 0,
            reason: 'Insufficient OHLCV data',
          });
        }
      }

      if (callsToSimulate.length === 0) {
        ctx.logger.warn('No calls have sufficient OHLCV data for simulation', {
          totalCalls: callsQueried,
          skipped: initialSkippedTokens.length,
        });
      }

      config.mints = callsToSimulate.map((call) => call.mint);
      config.alert_timestamps = callsToSimulate.map((call) => call.alert_timestamp);
      config.skipTokens = initialSkippedTokens.map((token) => ({
        mint: token.mint,
        alert_timestamp: token.alertTimestamp,
      }));
    } else {
      callsToSimulate = callsResult.calls;
      config.mints = callsToSimulate.map((call) => call.mint);
      config.alert_timestamps = callsToSimulate.map((call) => call.alert_timestamp);
    }
  } else {
    // Single mode
    if (!validated.mint) {
      throw new ValidationError('mint is required for single simulation', {
        operation: 'run_simulation_duckdb',
        mode: 'single',
      });
    }
    config.mint = validated.mint;
    config.alert_timestamp = validated.alertTimestamp || DateTime.utc().toISO()!;
    callsQueried = 1;
    callsToSimulate = [{ mint: validated.mint, alert_timestamp: config.alert_timestamp }];
  }

  // 5. Run simulation
  let simulationResults: SimulationOutput;
  try {
    simulationResults = await ctx.services.simulation.runSimulation(config);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Simulation failed', { error: errorMessage });
    if (errorMode === 'failFast') {
      throw error;
    }
    // Return partial results
    simulationResults = {
      results: callsToSimulate.map((call) => ({
        error: errorMessage,
        mint: call.mint,
        alert_timestamp: call.alert_timestamp,
      })),
      summary: {
        total_runs: callsToSimulate.length,
        successful: 0,
        failed: callsToSimulate.length,
      },
    };
  }

  // 6. Collect skipped tokens from simulation results
  const skippedTokens: SkippedToken[] = [...initialSkippedTokens];

  if (simulationResults.results) {
    for (const simResult of simulationResults.results) {
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
            lookbackMinutes: simResult.lookback_minutes ?? validated.lookbackMinutes ?? 0,
            lookforwardMinutes: simResult.lookforward_minutes ?? validated.lookforwardMinutes ?? 0,
            reason: simResult.error || 'Insufficient data',
          });
        }
      }
    }
  }

  let callsRetried = 0;
  let tokensIngested = 0;
  let tokensUnrecoverable = 0;
  let retryAttempts = 0;

  // 7. Retry loop: if tokens were skipped, trigger OHLCV ingestion and re-run
  if (skippedTokens.length > 0 && retryAttempts < maxRetries) {
    ctx.logger.info('Tokens skipped due to insufficient data, triggering OHLCV ingestion', {
      skippedCount: skippedTokens.length,
      retryAttempt: retryAttempts,
    });

    try {
      // Trigger OHLCV ingestion for skipped tokens
      const queueItems = skippedTokens.map((token) => ({
        mint: token.mint,
        alertTimestamp: token.alertTimestamp,
        queuedAt: DateTime.utc().toISO()!,
      }));

      // Note: We need to call the ingestion service directly here since we need the queueItems
      // The workflow doesn't support queueItems yet, so we use the service
      const ingestionResult = await ctx.services.ohlcvIngestion.ingestForCalls({
        duckdbPath: validated.duckdbPath,
        preWindowMinutes: validated.lookbackMinutes ?? 0,
        postWindowMinutes: validated.lookforwardMinutes ?? 0,
        queueItems,
      });

      tokensIngested = ingestionResult.queueItemsProcessed?.length ?? 0;

      // Update metadata for successfully processed tokens
      const queueItemsProcessed = ingestionResult.queueItemsProcessed || [];
      for (const item of queueItemsProcessed) {
        const alertTime = DateTime.fromISO(item.alertTimestamp);
        if (!alertTime.isValid) continue;

        const timeRangeStart = alertTime
          .minus({ minutes: validated.lookbackMinutes ?? 0 })
          .toISO()!;
        const timeRangeEnd = alertTime
          .plus({ minutes: validated.lookforwardMinutes ?? 0 })
          .toISO()!;

        await ctx.services.duckdbStorage.updateOhlcvMetadata(
          validated.duckdbPath,
          item.mint,
          item.alertTimestamp,
          300, // 5 minutes in seconds
          timeRangeStart,
          timeRangeEnd,
          ingestionResult.candlesFetched5m || 0
        );
      }

      // Check for unrecoverable tokens
      const unrecoverable = ingestionResult.tokensUnrecoverable || [];
      tokensUnrecoverable = unrecoverable.length;
      if (unrecoverable.length > 0) {
        for (const token of unrecoverable) {
          await ctx.services.duckdbStorage.addOhlcvExclusion(
            validated.duckdbPath,
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
        ctx.logger.info('Re-running simulation for previously skipped tokens', {
          retryCount: tokensToRetry.length,
        });

        const retryConfig: SimulationConfig = {
          ...config,
          mints: tokensToRetry.map((token) => token.mint),
          alert_timestamps: tokensToRetry.map((token) => token.alertTimestamp),
          resume: false, // Don't skip on retry, try to run
        };

        const retryResult = await ctx.services.simulation.runSimulation(retryConfig);
        callsRetried = tokensToRetry.length;

        // Merge retry results with original results
        if (retryResult.results) {
          const resultMap = new Map<string, any>();
          retryResult.results.forEach((r: any) => {
            if (r.mint && r.alert_timestamp) {
              resultMap.set(`${r.mint}:${r.alert_timestamp}`, r as any);
            }
          });

          simulationResults.results = simulationResults.results.map((r: any) => {
            if (r.mint && r.alert_timestamp) {
              const retry = resultMap.get(`${r.mint}:${r.alert_timestamp}`);
              return retry || r;
            }
            return r;
          });

          // Update summary
          simulationResults.summary = {
            total_runs: simulationResults.summary.total_runs,
            successful: simulationResults.results.filter((r: any) => !r.error && !r.skipped).length,
            failed: simulationResults.results.filter((r: any) => r.error || r.skipped).length,
          };
        }

        retryAttempts++;
      }
    } catch (error) {
      ctx.logger.error('Failed to trigger OHLCV ingestion for skipped tokens', error as Error);
      // Continue with original results even if ingestion fails
    }
  }

  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt, 'milliseconds').milliseconds;

  // Calculate success metrics
  const callsSimulated = callsToSimulate.length;
  const callsSucceeded = simulationResults.results
    ? simulationResults.results.filter((r: any) => !r.error && !r.skipped).length
    : 0;
  const callsFailed = simulationResults.results
    ? simulationResults.results.filter((r: any) => r.error || r.skipped).length
    : 0;
  const success = callsFailed === 0 && callsSimulated > 0;

  ctx.logger.info('Completed DuckDB simulation workflow', {
    callsQueried,
    callsSimulated,
    callsSucceeded,
    callsFailed,
    callsSkipped: skippedTokens.length,
    callsRetried,
    tokensIngested,
  });

  return {
    success,
    simulationResults,
    callsQueried,
    callsSimulated,
    callsSucceeded,
    callsFailed,
    callsSkipped: skippedTokens.length,
    callsRetried,
    tokensIngested,
    tokensUnrecoverable,
    skippedTokens,
    retryAttempts,
    startedAtISO,
    completedAtISO,
    durationMs,
  };
}
