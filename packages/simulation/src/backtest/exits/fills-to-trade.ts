import type { ExitSimResult } from './exit-plan.js';

export type PnlInputs = {
  positionUsd: number;
  entryPx: number;
  fills: ExitSimResult['fills']; // net prices already friction-adjusted
};

export function fillsToNetReturnPct({ positionUsd, entryPx, fills }: PnlInputs): {
  netReturnPct: number;
  grossReturnPct: number;
  proceedsUsd: number;
  costUsd: number;
} {
  // Simple model:
  // - cost is positionUsd (fixed notional)
  // - entry gets you units = positionUsd / entryPx
  // - each fill sells fraction of original units at fill px
  const costUsd = positionUsd;
  const units = positionUsd / entryPx;

  let proceedsUsd = 0;
  let soldFrac = 0;

  for (const f of fills) {
    soldFrac += f.fraction;
    proceedsUsd += units * f.fraction * f.px;
  }

  // If somehow not fully exited, treat remainder as marked to last fill price (or ignore).
  // Better: your simulator should exit remainder via timeout/indicator/stop.
  const grossReturnPct = ((proceedsUsd - costUsd) / costUsd) * 100;
  const netReturnPct = grossReturnPct; // fills are already net-of-fee/slippage in simulateExitPlan

  return { netReturnPct, grossReturnPct, proceedsUsd, costUsd };
}
