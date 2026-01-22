import type { ExitPlan } from './exit-plan-validate.js';
import { parseExitPlan } from './exit-plan-validate.js';
import { loadStrategyConfigJson, ensureBacktestStrategyTables } from './duckdb-strategy-store.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type duckdb = any;

export async function resolveExitPlanFromDuckDb(db: any, strategyId: string): Promise<ExitPlan> {
  await ensureBacktestStrategyTables(db);
  const json = await loadStrategyConfigJson(db, strategyId);
  return parseExitPlan(json);
}
