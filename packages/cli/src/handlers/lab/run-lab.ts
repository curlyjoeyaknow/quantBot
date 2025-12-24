/**
 * Lab Simulation Handler
 * =======================
 * Runs simulations on existing candles using preset indicator signals
 */

import type { CommandContext } from '../../core/command-context.js';
import type { LabRunArgs } from '../../command-defs/lab.js';
import {
  getSignalPreset,
  combineSignalPresets,
  getPreset,
  simulateStrategy,
} from '@quantbot/simulation';
import { DateTime } from 'luxon';
import type { StrategyConfig, StrategyLeg, SignalGroup } from '@quantbot/simulation';

export interface LabRunResult {
  success: boolean;
  runId?: string;
  callsSimulated: number;
  callsSucceeded: number;
  callsFailed: number;
  results: Array<{
    callId: string;
    mint: string;
    createdAtISO: string;
    ok: boolean;
    pnlMultiplier?: number;
    trades?: number;
    errorCode?: string;
    errorMessage?: string;
  }>;
  summary: {
    avgPnl?: number;
    minPnl?: number;
    maxPnl?: number;
    totalTrades: number;
    winRate?: number;
  };
}

/**
 * Normalize SignalGroup to ensure logic is set (required by types/signals.ts)
 * Handles the type mismatch between config.ts SignalGroup (optional logic) and types/signals.ts SignalGroup (required logic)
 *
 * Edge cases handled:
 * - undefined logic → defaults to 'AND'
 * - undefined conditions → defaults to []
 * - undefined groups → defaults to undefined (not [] to avoid type issues)
 * - nested groups are recursively normalized
 */
function normalizeSignalGroup(group: { logic?: 'AND' | 'OR'; conditions?: unknown[]; groups?: unknown[]; id?: string }): SignalGroup {
  return {
    ...group,
    logic: (group.logic ?? 'AND') as 'AND' | 'OR',
    conditions: group.conditions ?? [],
    groups: group.groups && group.groups.length > 0 
      ? group.groups.map((g) => normalizeSignalGroup(g as typeof group))
      : undefined,
  } as SignalGroup;
}

export async function runLabHandler(args: LabRunArgs, ctx: CommandContext): Promise<LabRunResult> {
  // Get entry signal preset(s)
  let entrySignal: SignalGroup | undefined;
  if (args.entryPresets && args.entryPresets.length > 0) {
    const combined = combineSignalPresets(args.entryPresets, 'AND');
    if (!combined) {
      throw new Error(`Invalid entry preset(s): ${args.entryPresets.join(', ')}`);
    }
    entrySignal = normalizeSignalGroup(combined);
  } else if (args.entryPreset) {
    const preset = getSignalPreset(args.entryPreset);
    if (!preset) {
      throw new Error(`Invalid entry preset: ${args.entryPreset}`);
    }
    entrySignal = normalizeSignalGroup(preset);
  }

  // Get exit signal preset(s)
  let exitSignal: SignalGroup | undefined;
  if (args.exitPresets && args.exitPresets.length > 0) {
    const combined = combineSignalPresets(args.exitPresets, 'AND');
    if (!combined) {
      throw new Error(`Invalid exit preset(s): ${args.exitPresets.join(', ')}`);
    }
    exitSignal = normalizeSignalGroup(combined);
  } else if (args.exitPreset) {
    const preset = getSignalPreset(args.exitPreset);
    if (!preset) {
      throw new Error(`Invalid exit preset: ${args.exitPreset}`);
    }
    exitSignal = normalizeSignalGroup(preset);
  }

  // Get strategy config (from preset or custom)
  let strategyConfig: StrategyConfig;
  if (args.strategyPreset) {
    const preset = getPreset(args.strategyPreset);
    if (!preset) {
      throw new Error(`Invalid strategy preset: ${args.strategyPreset}`);
    }
    strategyConfig = preset;
  } else {
    // Build custom strategy config
    strategyConfig = {
      name: 'Lab_Custom',
      profitTargets: args.profitTargets || [],
      stopLoss: args.stopLoss,
      holdHours: args.holdHours,
    };
  }

  // Add signals to strategy config
  if (entrySignal) {
    strategyConfig.entrySignal = entrySignal;
  }
  if (exitSignal) {
    strategyConfig.exitSignal = exitSignal;
  }

  // Get calls from DuckDB storage
  const duckdbStorage = ctx.services.duckdbStorage();
  const dbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const fromDate = args.from ? DateTime.fromISO(args.from) : DateTime.now().minus({ days: 7 });
  const toDate = args.to ? DateTime.fromISO(args.to) : DateTime.now();

  // Query calls from DuckDB
  const callsResult = await duckdbStorage.queryCalls(
    dbPath,
    args.limit,
    false, // excludeUnrecoverable
    args.caller
  );

  if (!callsResult.success || !callsResult.calls) {
    throw new Error(callsResult.error || 'Failed to query calls from DuckDB');
  }

  // Filter calls by date range and mint if specified
  let calls = callsResult.calls.filter((call) => {
    const callDate = DateTime.fromISO(call.alert_timestamp);
    if (callDate < fromDate || callDate > toDate) {
      return false;
    }
    if (args.mint && call.mint !== args.mint) {
      return false;
    }
    return true;
  });

  // Limit results
  if (calls.length > args.limit) {
    calls = calls.slice(0, args.limit);
  }

  if (calls.length === 0) {
    return {
      success: true,
      callsSimulated: 0,
      callsSucceeded: 0,
      callsFailed: 0,
      results: [],
      summary: {
        totalTrades: 0,
      },
    };
  }

  // Run simulations using core simulator
  const storageEngine = ctx.services.storageEngine();

  const results: LabRunResult['results'] = [];
  let callsSucceeded = 0;
  let callsFailed = 0;
  const pnlValues: number[] = [];
  let totalTrades = 0;

  // Convert strategy config to strategy legs
  const strategyLegs: StrategyLeg[] = strategyConfig.profitTargets || [];

  for (const call of calls) {
    try {
      // Get candles for this call using storage engine
      const callDate = DateTime.fromISO(call.alert_timestamp);
      const fromWindow = callDate.minus({ minutes: args.preWindow });
      const toWindow = callDate.plus({ minutes: args.postWindow });

      const candles = await storageEngine.getCandles(
        call.mint,
        'solana',
        fromWindow,
        toWindow,
        { interval: '5m' }
      );

      if (candles.length === 0) {
        results.push({
          callId: call.mint + '_' + call.alert_timestamp,
          mint: call.mint,
          createdAtISO: callDate.toISO()!,
          ok: false,
          errorCode: 'NO_CANDLES',
          errorMessage: 'No candles available for this call',
        });
        callsFailed++;
        continue;
      }

      // Run simulation using core simulator
      const simResult = await simulateStrategy(
        candles,
        strategyLegs,
        strategyConfig.stopLoss,
        strategyConfig.entry,
        strategyConfig.reEntry,
        strategyConfig.costs,
        {
          entrySignal: strategyConfig.entrySignal,
          exitSignal: strategyConfig.exitSignal,
          entryLadder: strategyConfig.entryLadder,
          exitLadder: strategyConfig.exitLadder,
        }
      );

      // Calculate PnL multiplier (finalPnl is already a multiplier where 1 = break even)
      const pnlMultiplier = simResult.finalPnl;
      const trades = simResult.events.filter((e) => e.type === 'entry' || e.type === 'stop_loss' || e.type === 'target_hit' || e.type === 'final_exit').length;

      callsSucceeded++;
      pnlValues.push(pnlMultiplier);
      totalTrades += trades;

      results.push({
        callId: call.mint + '_' + call.alert_timestamp,
        mint: call.mint,
        createdAtISO: callDate.toISO()!,
        ok: true,
        pnlMultiplier,
        trades,
      });
    } catch (error) {
      callsFailed++;
      const callDate = DateTime.fromISO(call.alert_timestamp);
      results.push({
        callId: call.mint + '_' + call.alert_timestamp,
        mint: call.mint,
        createdAtISO: callDate.toISO()!,
        ok: false,
        errorCode: 'SIMULATION_ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Calculate summary
  const successfulResults = results.filter((r) => r.ok && r.pnlMultiplier !== undefined);
  const avgPnl =
    pnlValues.length > 0 ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length : undefined;
  const minPnl = pnlValues.length > 0 ? Math.min(...pnlValues) : undefined;
  const maxPnl = pnlValues.length > 0 ? Math.max(...pnlValues) : undefined;
  const winRate =
    successfulResults.length > 0
      ? successfulResults.filter((r) => (r.pnlMultiplier ?? 0) > 1).length /
        successfulResults.length
      : undefined;

  return {
    success: true,
    callsSimulated: calls.length,
    callsSucceeded,
    callsFailed,
    results,
    summary: {
      avgPnl,
      minPnl,
      maxPnl,
      totalTrades,
      winRate,
    },
  };
}

