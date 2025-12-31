/**
 * Run Orchestrator Implementation
 *
 * Coordinates run creation, execution, and status tracking.
 * Integrates with existing planning, coverage, slice materialization, and simulation services.
 */

import { DateTime } from 'luxon';
import { NotFoundError, ValidationError, getDuckDBPath } from '@quantbot/utils';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { WorkflowContext } from '../types.js';
import type {
  RunOrchestrator,
  CreateRunParams,
  RunSummary,
  TradeFilters,
  Trade,
  Page,
} from './RunOrchestrator.js';
import { planRun } from './planRun.js';
import { coveragePreflight } from './coveragePreflight.js';
import { materializeSlices } from './materializeSlices.js';
import { runSimulation } from './runSimulation.js';
import { simulateToken, validateStrategy, type StrategyConfig } from '@quantbot/simulation/engine';
import { loadSlice } from './materializeSlices.js';
import {
  FiltersRepository,
  RunsRepository,
  RunTradesRepository,
  type SimulatorRunStatus,
} from '@quantbot/storage';
import { getStorageEngine } from '@quantbot/storage';
import { getArtifactsDir, RunPlanV1Schema, type RunPlanV1 } from '@quantbot/core';

/**
 * Create Run Orchestrator instance
 */
export function createRunOrchestrator(ctx: WorkflowContext): RunOrchestrator {
  const dbPath = getDuckDBPath('data/tele.duckdb');
  const filtersRepo = new FiltersRepository(dbPath);
  const runsRepo = new RunsRepository(dbPath);
  const runTradesRepo = new RunTradesRepository(dbPath);

  return {
    async createRun(params: CreateRunParams): Promise<string> {
      // Validate inputs
      if (params.to_ts <= params.from_ts) {
        throw new ValidationError('to_ts must be after from_ts', {
          from_ts: params.from_ts.toISO(),
          to_ts: params.to_ts.toISO(),
        });
      }

      // Get strategy
      const strategy = await ctx.repos.strategies.getByName(params.strategy_id);
      if (!strategy) {
        throw new NotFoundError('Strategy', params.strategy_id);
      }

      // Validate strategy config
      let strategyConfig: StrategyConfig;
      try {
        validateStrategy(strategy.config);
        strategyConfig = strategy.config as StrategyConfig;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new ValidationError(`Strategy config validation failed: ${msg}`, {
          strategy_id: params.strategy_id,
          error: msg,
        });
      }

      // Get filter
      const filter = await filtersRepo.findById(params.filter_id);
      if (!filter) {
        throw new NotFoundError('Filter', params.filter_id);
      }

      // Generate run ID
      const runId = ctx.ids.newRunId();
      const interval = params.interval || '5m';

      // Create run record with 'pending' status
      await runsRepo.create({
        run_id: runId,
        strategy_id: params.strategy_id,
        filter_id: params.filter_id,
        status: 'pending',
      });

      ctx.logger.info('Run created', {
        runId,
        strategy_id: params.strategy_id,
        filter_id: params.filter_id,
        from_ts: params.from_ts.toISO(),
        to_ts: params.to_ts.toISO(),
        interval,
      });

      return runId;
    },

    async executeRun(runId: string): Promise<SimulatorRunStatus> {
      // Get run record
      const run = await runsRepo.findById(runId);
      if (!run) {
        throw new NotFoundError('Run', runId);
      }

      // Update status to 'running'
      await runsRepo.update(runId, { status: 'running' });

      try {
        // Get strategy and filter
        const strategy = await ctx.repos.strategies.getByName(run.strategy_id);
        if (!strategy) {
          throw new NotFoundError('Strategy', run.strategy_id);
        }

        const filter = await filtersRepo.findById(run.filter_id);
        if (!filter) {
          throw new NotFoundError('Filter', run.filter_id);
        }

        // Validate strategy config
        let strategyConfig: StrategyConfig;
        try {
          validateStrategy(strategy.config);
          strategyConfig = strategy.config as StrategyConfig;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new ValidationError(`Strategy config validation failed: ${msg}`, {
            strategy_id: run.strategy_id,
            error: msg,
          });
        }

        // Get calls based on filter (for now, use existing calls.list - filter integration TBD)
        // TODO: Apply filter criteria to calls.list
        const fromISO = DateTime.now().minus({ days: 7 }).toISO()!; // Placeholder - should come from run params
        const toISO = DateTime.now().toISO()!; // Placeholder - should come from run params

        const calls = await ctx.repos.calls.list({
          fromISO,
          toISO,
        });

        if (calls.length === 0) {
          await runsRepo.update(runId, {
            status: 'failed_preflight',
            finished_at: DateTime.utc(),
          });
          return 'failed_preflight';
        }

        // Dedup calls
        const byId = new Map<string, (typeof calls)[number]>();
        for (const c of calls) {
          if (!byId.has(c.id)) byId.set(c.id, c);
        }
        const uniqueCalls = [...byId.values()].sort(
          (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()
        );

        // Plan run
        const interval = '5m'; // Default - should come from run params
        const plan = planRun(strategyConfig, uniqueCalls, interval, 0, 0);

        // Write plan artifact
        const intervalSeconds = (() => {
          const normalized = interval.toLowerCase();
          if (normalized === '1s') return 1;
          if (normalized === '15s') return 15;
          if (normalized === '1m') return 60;
          if (normalized === '5m') return 300;
          if (normalized === '15m') return 900;
          if (normalized === '1h') return 3600;
          if (normalized === '4h') return 14400;
          if (normalized === '1d') return 86400;
          return 300; // default to 5m
        })();

        // Find earliest and latest call times for requested range
        const callTimes = uniqueCalls.map((c) => c.createdAt);
        const earliestCall = callTimes.length > 0 ? DateTime.min(...callTimes) : DateTime.utc();
        const latestCall = callTimes.length > 0 ? DateTime.max(...callTimes) : DateTime.utc();

        const runPlan: RunPlanV1 = {
          schema_version: 1,
          run_id: runId,
          interval_seconds: intervalSeconds,
          requested_range: {
            from_ts: earliestCall.toISO()!,
            to_ts: latestCall.toISO()!,
          },
          requirements: {
            indicator_warmup_candles: plan.requiredWarmupCandles,
            entry_delay_candles: plan.requiredDelay,
            max_hold_candles: plan.maxHoldingCandles,
            pre_entry_context_candles: 50, // Default padding
            total_required_candles: plan.tokenRequirements.reduce(
              (max, req) => Math.max(max, req.requiredCandleCount),
              0
            ),
          },
          per_token_windows: plan.tokenRequirements.map((req) => ({
            token: req.token,
            from_ts: req.requiredFromTs.toISO()!,
            to_ts: req.requiredToTs.toISO()!,
            required_candles: req.requiredCandleCount,
          })),
        };

        // Validate plan before writing
        const validatedPlan = RunPlanV1Schema.parse(runPlan);

        // Write plan to artifacts directory
        const artifactsDir = getArtifactsDir();
        const runArtifactsDir = join(artifactsDir, runId);
        await mkdir(runArtifactsDir, { recursive: true });
        const planPath = join(runArtifactsDir, 'plan.json');
        await writeFile(planPath, JSON.stringify(validatedPlan, null, 2), 'utf8');

        ctx.logger.info('Run plan written', {
          runId,
          planPath,
          tokenCount: validatedPlan.per_token_windows.length,
        });

        // Coverage preflight (pass runId to write coverage artifact)
        const coverage = await coveragePreflight(plan, ctx, runId);

        if (coverage.eligibleTokens.length === 0) {
          await runsRepo.update(runId, {
            status: 'failed_preflight',
            finished_at: DateTime.utc(),
          });
          return 'failed_preflight';
        }

        // Materialize slices
        const slices = await materializeSlices(plan, coverage.eligibleTokens, ctx, runId);

        // Run simulation for each eligible token
        const allTrades: Array<{
          run_id: string;
          token: string;
          trade_id: string;
          entry_ts: DateTime;
          exit_ts: DateTime;
          entry_price: number;
          exit_price: number;
          pnl_pct: number;
          exit_reason: string;
        }> = [];

        for (const call of uniqueCalls) {
          const slicePath = slices.slicePaths.get(call.mint);
          if (!slicePath) {
            continue; // Token was excluded
          }

          try {
            const candles = await loadSlice(slicePath);
            if (candles.length === 0) {
              continue;
            }

            const simResult = simulateToken(call.mint, candles, strategyConfig);

            // Convert trades to database format
            for (const trade of simResult.trades) {
              allTrades.push({
                run_id: runId,
                token: call.mint,
                trade_id: trade.trade_id,
                entry_ts: DateTime.fromISO(trade.entry_ts),
                exit_ts: DateTime.fromISO(trade.exit_ts),
                entry_price: trade.entry_price,
                exit_price: trade.exit_price,
                pnl_pct: trade.pnl_pct,
                exit_reason: trade.exit_reason,
              });
            }
          } catch (error) {
            ctx.logger.error('Simulation failed for token', {
              runId,
              token: call.mint,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue with other tokens
          }
        }

        // Store trades
        if (allTrades.length > 0) {
          await runTradesRepo.insertMany(allTrades);
        }

        // Determine final status
        const finalStatus: SimulatorRunStatus =
          coverage.eligibleTokens.length < uniqueCalls.length
            ? 'complete_partial_universe'
            : 'complete';

        // Create summary
        const summary = {
          total_calls: uniqueCalls.length,
          eligible_tokens: coverage.eligibleTokens.length,
          excluded_tokens: coverage.excludedTokens.length,
          total_trades: allTrades.length,
          win_rate:
            allTrades.length > 0
              ? allTrades.filter((t) => t.pnl_pct > 0).length / allTrades.length
              : 0,
          avg_pnl_pct:
            allTrades.length > 0
              ? allTrades.reduce((sum, t) => sum + t.pnl_pct, 0) / allTrades.length
              : 0,
        };

        // Update run with final status and summary
        await runsRepo.update(runId, {
          status: finalStatus,
          summary_json: summary,
          finished_at: DateTime.utc(),
        });

        ctx.logger.info('Run execution completed', {
          runId,
          status: finalStatus,
          total_trades: allTrades.length,
        });

        return finalStatus;
      } catch (error) {
        // Update status to 'failed'
        await runsRepo.update(runId, {
          status: 'failed',
          finished_at: DateTime.utc(),
        });

        ctx.logger.error('Run execution failed', {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    },

    async getRun(runId: string): Promise<RunSummary> {
      const run = await runsRepo.findById(runId);
      if (!run) {
        throw new NotFoundError('Run', runId);
      }

      return {
        run_id: run.run_id,
        strategy_id: run.strategy_id,
        filter_id: run.filter_id,
        status: run.status,
        summary_json: run.summary_json,
        created_at: run.created_at,
        finished_at: run.finished_at,
      };
    },

    async listTrades(runId: string, filters?: TradeFilters): Promise<Page<Trade>> {
      const trades = await runTradesRepo.listByRunId(runId, filters?.limit || 1000);

      // Apply token filter if provided
      let filteredTrades = trades;
      if (filters?.token) {
        filteredTrades = trades.filter((t) => t.token === filters.token);
      }

      // Apply pagination
      const offset = filters?.offset || 0;
      const limit = filters?.limit || 1000;
      const paginatedTrades = filteredTrades.slice(offset, offset + limit);

      return {
        items: paginatedTrades.map((t) => ({
          run_id: t.run_id,
          token: t.token,
          trade_id: t.trade_id,
          entry_ts: t.entry_ts,
          exit_ts: t.exit_ts,
          entry_price: t.entry_price,
          exit_price: t.exit_price,
          pnl_pct: t.pnl_pct,
          exit_reason: t.exit_reason,
        })),
        total: filteredTrades.length,
        limit,
        offset,
      };
    },
  };
}
