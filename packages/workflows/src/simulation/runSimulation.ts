import { z } from 'zod';
import type { DateTime } from 'luxon';
import { ValidationError, NotFoundError, getCurrentGitCommitHash } from '@quantbot/utils';
import type {
  WorkflowContext,
  SimulationRunSpec,
  SimulationRunResult,
  SimulationCallResult,
} from '../types.js';
import { createProductionContext } from '../context/createProductionContext.js';

const isLuxonDateTime = (v: unknown): v is DateTime => {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.isValid === 'boolean' && obj.isValid === true && typeof obj.toISO === 'function'
  );
};

const SpecSchema = z.object({
  strategyName: z.string().min(1, 'strategyName is required'),
  callerName: z.string().min(1).optional(),
  from: z.custom<DateTime>(isLuxonDateTime, 'from must be a Luxon DateTime'),
  to: z.custom<DateTime>(isLuxonDateTime, 'to must be a Luxon DateTime'),
  options: z
    .object({
      dryRun: z.boolean().optional(),
      preWindowMinutes: z
        .number()
        .int()
        .min(0)
        .max(60 * 24)
        .optional(),
      postWindowMinutes: z
        .number()
        .int()
        .min(0)
        .max(60 * 24)
        .optional(),
    })
    .optional(),
});

function median(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  const prev = s[mid - 1];
  const curr = s[mid];
  if (prev === undefined || curr === undefined) return undefined;
  return (prev + curr) / 2;
}

/**
 * Create default context (for testing)
 */
export function createDefaultRunSimulationContext(): WorkflowContext {
  return createProductionContext();
}

export async function runSimulation(
  spec: SimulationRunSpec,
  ctx: WorkflowContext = createDefaultRunSimulationContext()
): Promise<SimulationRunResult> {
  const parsed = SpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid simulation spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const fromISO = spec.from.toISO()!;
  const toISO = spec.to.toISO()!;
  if (spec.to <= spec.from) {
    throw new ValidationError(`Invalid date range: to must be after from`, {
      from: fromISO,
      to: toISO,
    });
  }

  const dryRun = spec.options?.dryRun ?? false;
  const preMin = spec.options?.preWindowMinutes ?? 0;
  const postMin = spec.options?.postWindowMinutes ?? 0;

  const runId = ctx.ids.newRunId();

  const strategy = await ctx.repos.strategies.getByName(spec.strategyName);
  if (!strategy) {
    throw new NotFoundError('Strategy', spec.strategyName);
  }

  const calls = await ctx.repos.calls.list({
    callerName: spec.callerName,
    fromISO,
    toISO,
  });

  // Dedup by call id; keep earliest instance.
  const byId = new Map<string, (typeof calls)[number]>();
  for (const c of calls) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const uniqueCalls = [...byId.values()].sort(
    (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()
  );

  const results: SimulationCallResult[] = [];
  const pnlOk: number[] = [];
  let tradesTotal = 0;
  // Collect all events from all calls for writing to parquet
  const allEvents: Array<{
    run_id: string;
    call_id: string;
    token_id: string;
    type: string;
    ts: number;
    price: number;
    size?: number;
    pnl?: number;
    pnl_so_far?: number;
    remaining_position?: number;
    reason?: string;
  }> = [];

  // Emit structured event instead of verbose debug log
  ctx.logger.info('Simulation run started', {
    runId,
    strategy: strategy.name,
    calls: uniqueCalls.length,
    dryRun,
  });

  for (const call of uniqueCalls) {
    const callISO = call.createdAt.toISO()!;
    try {
      // Workflow-controlled time window (conservative: window around call timestamp)
      const fromWindow = call.createdAt.minus({ minutes: preMin });
      const toWindow = call.createdAt.plus({ minutes: postMin });

      // Use causal accessor - this is the ONLY path (Gate 2 compliance).
      // It is structurally impossible to pass raw candles into simulation.run().
      const startTime = fromWindow.toUnixInteger();
      const endTime = toWindow.toUnixInteger();

      // Check if candles are available (quick check via causal accessor)
      const initialCandle = await ctx.ohlcv.causalAccessor.getLastClosedCandle(
        call.mint,
        startTime,
        '5m'
      );

      if (!initialCandle) {
        results.push({
          callId: call.id,
          mint: call.mint,
          createdAtISO: callISO,
          ok: false,
          errorCode: 'NO_CANDLES',
          errorMessage: 'No candles returned for target window',
        });
        continue;
      }

      // Run simulation with causal accessor (mandatory - no raw candles allowed)
      const sim = (await ctx.simulation.run({
        candleAccessor: ctx.ohlcv.causalAccessor, // Only path - enforced by type system
        mint: call.mint,
        startTime,
        endTime,
        strategy,
        call,
      })) as {
        pnlMultiplier: number;
        trades: number;
        events?: Array<{
          type: string;
          timestamp: number;
          price: number;
          remainingPosition?: number;
          pnlSoFar?: number;
        }>;
      };

      pnlOk.push(sim.pnlMultiplier);
      tradesTotal += sim.trades;

      // Collect events if available
      if (sim.events && sim.events.length > 0) {
        if (ctx.logger.debug) {
          ctx.logger.debug('Collecting events from simulation', {
            runId,
            callId: call.id,
            eventCount: sim.events.length,
          });
        }
        for (const event of sim.events) {
          allEvents.push({
            run_id: runId,
            call_id: call.id,
            token_id: call.mint,
            type: event.type,
            ts: event.timestamp * 1000, // Convert to milliseconds
            price: event.price,
            pnl_so_far: event.pnlSoFar,
            remaining_position: event.remainingPosition,
          });
        }
      } else {
        if (ctx.logger.debug) {
          ctx.logger.debug('No events returned from simulation', {
            runId,
            callId: call.id,
            hasEvents: !!sim.events,
          });
        }
      }

      results.push({
        callId: call.id,
        mint: call.mint,
        createdAtISO: callISO,
        ok: true,
        pnlMultiplier: sim.pnlMultiplier,
        trades: sim.trades,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        callId: call.id,
        mint: call.mint,
        createdAtISO: callISO,
        ok: false,
        errorCode: 'SIMULATION_ERROR',
        errorMessage: msg,
      });
      // Continue (per-call errors should not kill the run)
      // Only log errors, not warnings for per-call failures (too verbose)
      ctx.logger.error('Simulation call failed', {
        runId,
        callId: call.id,
        mint: call.mint,
        error: msg,
      });
    }
  }

  const callsAttempted = uniqueCalls.length;
  const callsSucceeded = results.filter((r) => r.ok).length;
  const callsFailed = results.length - callsSucceeded;

  const pnlMin = pnlOk.length ? Math.min(...pnlOk) : undefined;
  const pnlMax = pnlOk.length ? Math.max(...pnlOk) : undefined;
  const pnlMean = pnlOk.length ? pnlOk.reduce((a, b) => a + b, 0) / pnlOk.length : undefined;
  const pnlMedian = median(pnlOk);

  if (!dryRun) {
    // Capture git commit hash for experiment tracking (Phase IV)
    const gitCommitHash = getCurrentGitCommitHash();

    await ctx.repos.simulationRuns.create({
      runId,
      strategyId: strategy.id,
      strategyName: strategy.name,
      strategyConfig: strategy.config, // Store full config for reproducibility
      fromISO,
      toISO,
      callerName: spec.callerName,
      totalCalls: callsAttempted,
      successfulCalls: callsSucceeded,
      failedCalls: callsFailed,
      totalTrades: tradesTotal,
      pnlStats: {
        min: pnlMin,
        max: pnlMax,
        mean: pnlMean,
        median: pnlMedian,
      },
      gitCommitHash,
    });

    await ctx.repos.simulationResults.insertMany(runId, results);

    // Write events to parquet if we have any
    ctx.logger.info('Writing simulation events to parquet', {
      runId,
      eventCount: allEvents.length,
      callsSucceeded,
    });

    if (allEvents.length > 0) {
      try {
        const { getArtifactsDir } = await import('@quantbot/core');
        const { join } = await import('path');
        const { promises: fs } = await import('fs');
        const { DuckDBClient } = await import('@quantbot/storage');

        const artifactsDir = getArtifactsDir();
        const runDir = join(artifactsDir, runId);
        await fs.mkdir(runDir, { recursive: true });

        if (ctx.logger.debug) {
          ctx.logger.debug('Artifacts directory', {
            runId,
            artifactsDir,
            runDir,
          });
        }

        const db = new DuckDBClient(':memory:');
        try {
          await db.execute('INSTALL parquet;');
          await db.execute('LOAD parquet;');

          // Create table for events
          await db.execute(`
            CREATE TABLE temp_events (
              run_id TEXT,
              call_id TEXT,
              token_id TEXT,
              type TEXT,
              ts BIGINT,
              price DOUBLE,
              size DOUBLE,
              pnl DOUBLE,
              pnl_so_far DOUBLE,
              remaining_position DOUBLE,
              reason TEXT
            )
          `);

          // Insert events in batches
          const batchSize = 1000;
          for (let i = 0; i < allEvents.length; i += batchSize) {
            const batch = allEvents.slice(i, i + batchSize);
            for (const event of batch) {
              const values = [
                `'${event.run_id.replace(/'/g, "''")}'`,
                `'${event.call_id.replace(/'/g, "''")}'`,
                `'${event.token_id.replace(/'/g, "''")}'`,
                `'${event.type.replace(/'/g, "''")}'`,
                String(event.ts),
                String(event.price || 0),
                event.size !== undefined ? String(event.size) : 'NULL',
                event.pnl !== undefined ? String(event.pnl) : 'NULL',
                event.pnl_so_far !== undefined ? String(event.pnl_so_far) : 'NULL',
                event.remaining_position !== undefined ? String(event.remaining_position) : 'NULL',
                event.reason ? `'${event.reason.replace(/'/g, "''")}'` : 'NULL',
              ];
              await db.execute(
                `INSERT INTO temp_events (run_id, call_id, token_id, type, ts, price, size, pnl, pnl_so_far, remaining_position, reason) VALUES (${values.join(', ')})`
              );
            }
          }

          // Export to Parquet
          const parquetPath = join(runDir, 'events.parquet');
          await db.execute(
            `COPY temp_events TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)`
          );

          ctx.logger.info('Stored simulation events to parquet', {
            runId,
            eventCount: allEvents.length,
            parquetPath,
          });
        } finally {
          await db.close();
        }
      } catch (error) {
        ctx.logger.error('Error storing simulation events to parquet', {
          error: error instanceof Error ? error.message : String(error),
          runId,
          eventCount: allEvents.length,
        });
        // Don't throw - workflow should continue even if event storage fails
      }
    }
  }

  // Emit structured completion event
  ctx.logger.info('Simulation run completed', {
    runId,
    callsFound: calls.length,
    callsUnique: uniqueCalls.length,
    callsSucceeded,
    callsFailed,
    tradesTotal,
    dryRun,
  });

  return {
    runId,
    strategyName: spec.strategyName,
    callerName: spec.callerName,
    fromISO,
    toISO,
    dryRun,
    totals: {
      callsFound: calls.length,
      callsAttempted,
      callsSucceeded,
      callsFailed,
      tradesTotal,
    },
    pnl: {
      min: pnlMin,
      max: pnlMax,
      mean: pnlMean,
      median: pnlMedian,
    },
    results,
  };
}
