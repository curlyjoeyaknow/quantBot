import type { ExitPlan } from './exit-plan-validate.js';
import { parseExitPlan } from './exit-plan-validate.js';
import { loadStrategyConfigJson, ensureBacktestStrategyTables } from './duckdb-strategy-store.js';
import type duckdb from 'duckdb';

export async function resolveExitPlanFromDuckDb(
  db: duckdb.Database,
  strategyId: string
): Promise<ExitPlan> {
  await ensureBacktestStrategyTables(db);
  const json = await loadStrategyConfigJson(db, strategyId);
  return parseExitPlan(json);
}
