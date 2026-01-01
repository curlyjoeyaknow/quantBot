/**
 * @quantbot/backtest - Minimum Viable Backtester
 *
 * Golden path implementation with deterministic execution.
 */

export * from './types.js';
export * from './plan.js';
export * from './coverage.js';
export * from './slice.js';
export * from './engine/index.js';
export * from './report.js';
export * from './runBacktest.js';
export * from './reporting/caller-path-report.js';
export * from './reporting/run-list.js';
export * from './reporting/caller-leaderboard.js';
export * from './reporting/list-runs.js';

// Exit plan system
// Note: exit-plan.js exports ExitPlan type, which conflicts with exit-plan-validate.js
// Export only specific items to avoid conflicts
export type {
  ExitPlan,
  ExitFill,
  ExitSimParams,
  ExitSimResult,
  LadderLevel,
  TrailingStopSpec,
  IndicatorRule,
  IndicatorExitSpec,
  LadderExitSpec,
  IntrabarPolicy,
} from './exits/exit-plan.js';
export { candleTsMs } from './exits/exit-plan.js';
export * from './exits/simulate-exit-plan.js';
export * from './exits/indicator-eval.js';
export * from './exits/fills-to-trade.js';
export * from './exits/default-exit-plans.js';

// Indicator utilities
export * from './indicators/series.js';

// Exit-stack strategy system
// Note: exit-plan-validate.js exports ExitPlanZ (Zod schema), not ExitPlan type
export { ExitPlanZ, parseExitPlan } from './strategy/exit-plan-validate.js';
export * from './strategy/duckdb-strategy-store.js';
export * from './strategy/resolve-exit-plan.js';
// Note: backtest-exit-stack exports BacktestEvent and Trade which conflict with types.js
// Export only the function, not the types
export { backtestExitStack } from './engine/backtest-exit-stack.js';
// Note: run-exit-stack exports CallRecord which conflicts with types.js
export { runExitStack, type ExitStackRunArgs } from './run/run-exit-stack.js';
