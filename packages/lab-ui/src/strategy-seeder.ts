import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { DuckDb } from './db.js';
import { all, run } from './db.js';

/**
 * DSL Strategy format (from strategies/dsl/*.json)
 */
interface DslStrategy {
  version: string;
  name: string;
  description?: string;
  tags?: string[];
  entry: {
    type: 'immediate' | 'limit' | 'dip';
    dipPercent?: number;
    limitPrice?: number;
  };
  exit: Array<{
    type: 'profit_target' | 'stop_loss' | 'trailing_stop' | 'time';
    profitTarget?: number;
    percentToExit?: number;
    stopLossPercent?: number;
    trailingStopThreshold?: number;
    trailingStopPercent?: number;
    holdHours?: number;
  }>;
}

/**
 * Lab UI ExitPlan format (from exit-plan-schema.ts)
 */
interface ExitPlan {
  ladder?: {
    enabled: boolean;
    levels: Array<{
      kind: 'multiple' | 'pct';
      multiple?: number;
      pct?: number;
      fraction: number;
    }>;
  };
  trailing?: {
    enabled: boolean;
    trail_bps: number;
    activation?: {
      kind: 'multiple' | 'pct';
      multiple?: number;
      pct?: number;
    };
    hard_stop_bps?: number;
  };
  indicator?: {
    enabled: boolean;
    rules: unknown[];
  };
  max_hold_ms?: number;
}

/**
 * Convert a DSL strategy to Lab UI ExitPlan format
 */
function convertDslToExitPlan(dsl: DslStrategy): ExitPlan {
  const plan: ExitPlan = {};

  // Collect profit targets for ladder
  const profitTargets = dsl.exit.filter((e) => e.type === 'profit_target');
  if (profitTargets.length > 0) {
    plan.ladder = {
      enabled: true,
      levels: profitTargets.map((pt) => ({
        kind: 'multiple' as const,
        multiple: pt.profitTarget ?? 2.0,
        fraction: pt.percentToExit ?? 1.0,
      })),
    };
  }

  // Collect stop loss for trailing (use hard stop)
  const stopLoss = dsl.exit.find((e) => e.type === 'stop_loss');
  const trailingStop = dsl.exit.find(
    (e) => e.type === 'stop_loss' && e.trailingStopThreshold !== undefined
  );

  if (stopLoss || trailingStop) {
    // Convert percentage to basis points (e.g., -0.3 = -30% = -3000 bps)
    const hardStopBps = stopLoss?.stopLossPercent
      ? Math.abs(stopLoss.stopLossPercent) * 10000
      : undefined;

    if (trailingStop) {
      plan.trailing = {
        enabled: true,
        trail_bps: (trailingStop.trailingStopPercent ?? 0.2) * 10000,
        activation: {
          kind: 'multiple',
          multiple: trailingStop.trailingStopThreshold ?? 2.0,
        },
        hard_stop_bps: hardStopBps,
      };
    } else if (hardStopBps) {
      // Just a hard stop, no trailing
      plan.trailing = {
        enabled: true,
        trail_bps: hardStopBps, // Use hard stop as trail (will trigger immediately)
        hard_stop_bps: hardStopBps,
      };
    }
  }

  // Collect time exit for max hold
  const timeExit = dsl.exit.find((e) => e.type === 'time');
  if (timeExit?.holdHours) {
    plan.max_hold_ms = timeExit.holdHours * 60 * 60 * 1000;
  }

  // No indicator rules from DSL - leave empty
  plan.indicator = {
    enabled: false,
    rules: [],
  };

  return plan;
}

/**
 * Get the strategies directory path by checking multiple candidate locations
 */
async function getStrategiesDir(): Promise<string | null> {
  // Look for strategies/dsl relative to various locations
  const projectRoot = resolve(process.cwd());
  
  // Try several possible locations
  const candidates = [
    join(projectRoot, 'strategies', 'dsl'),             // Running from repo root
    join(projectRoot, '..', '..', 'strategies', 'dsl'), // Running from packages/lab-ui
    join(projectRoot, '..', 'strategies', 'dsl'),       // Running from packages/
  ];
  
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to next candidate
    }
  }
  
  return null;
}

/**
 * Seed default strategies from strategies/dsl/ folder
 * Returns the number of strategies seeded
 */
export async function seedDefaultStrategies(db: DuckDb): Promise<{
  seeded: number;
  skipped: number;
  errors: string[];
}> {
  const result = { seeded: 0, skipped: 0, errors: [] as string[] };

  try {
    const strategiesDir = await getStrategiesDir();
    
    if (!strategiesDir) {
      console.log('[strategy-seeder] No strategies/dsl directory found, skipping seed');
      return result;
    }
    
    const files = await readdir(strategiesDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    console.log(`[strategy-seeder] Found ${jsonFiles.length} strategy files in ${strategiesDir}`);

    for (const file of jsonFiles) {
      try {
        const filePath = join(strategiesDir, file);
        const content = await readFile(filePath, 'utf-8');
        const dsl: DslStrategy = JSON.parse(content);

        // Check if strategy with this name already exists
        const existing = await all(
          db,
          `SELECT strategy_id FROM backtest_strategies WHERE name = ?`,
          [dsl.name]
        );

        if (existing.length > 0) {
          console.log(`[strategy-seeder] Skipping "${dsl.name}" - already exists`);
          result.skipped++;
          continue;
        }

        // Convert and insert
        const exitPlan = convertDslToExitPlan(dsl);
        const configJson = JSON.stringify(exitPlan);
        const strategyId = nanoid(12);

        await run(
          db,
          `INSERT INTO backtest_strategies(strategy_id, name, config_json, created_at)
           VALUES (?, ?, ?, NOW())`,
          [strategyId, dsl.name, configJson]
        );

        console.log(`[strategy-seeder] Seeded "${dsl.name}" (${strategyId})`);
        result.seeded++;
      } catch (err) {
        const errMsg = `Error processing ${file}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[strategy-seeder] ${errMsg}`);
        result.errors.push(errMsg);
      }
    }
  } catch (err) {
    const errMsg = `Error reading strategies directory: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[strategy-seeder] ${errMsg}`);
    result.errors.push(errMsg);
  }

  console.log(
    `[strategy-seeder] Complete: ${result.seeded} seeded, ${result.skipped} skipped, ${result.errors.length} errors`
  );
  return result;
}

