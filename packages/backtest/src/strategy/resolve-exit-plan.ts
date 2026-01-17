import type { ExitPlan } from './exit-plan-validate.js';
import { parseExitPlan } from './exit-plan-validate.js';
import {
  loadStrategyConfigJson,
  ensureBacktestStrategyTables,
  openDuckDbFromEnv,
} from './duckdb-strategy-store.js';
import type { DuckDBClient } from '@quantbot/storage';

export async function resolveExitPlanFromDuckDb(
  db: DuckDBClient,
  strategyId: string
): Promise<ExitPlan> {
  await ensureBacktestStrategyTables(db);
  const json = await loadStrategyConfigJson(strategyId);
  return parseExitPlan(json);
}

/**
 * Resolve exit plan from DuckDB using environment variable for path
 */
export async function resolveExitPlanFromEnv(strategyId: string): Promise<ExitPlan> {
  const client = await openDuckDbFromEnv();
  return resolveExitPlanFromDuckDb(client, strategyId);
}
