import type { Candle } from '@quantbot/core';
import type { Chain, TokenAddress } from '@quantbot/core';
import type { ExitPlan } from '../strategy/exit-plan-validate.js';
import { simulateExitPlan } from '../exits/simulate-exit-plan.js';
import { fillsToNetReturnPct } from '../exits/fills-to-trade.js';

export type ExitStackInputs = {
  callId: string;
  caller: string;
  tokenAddress: TokenAddress;
  chain: Chain;

  candles: Candle[]; // chronologically sorted
  entryTsMs: number; // ms
  entryDelayMs: number; // ms (optional, but pass 0 if already applied)

  plan: ExitPlan;

  positionUsd: number;
  takerFeeBps: number;
  slippageBps: number;
};

export type BacktestEvent = {
  timestamp: number; // ms
  callId: string;
  tokenAddress: TokenAddress;
  price: number;
  event: string;
  position?: {
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
  };
};

export type Trade = {
  callId: string;
  tokenAddress: TokenAddress;
  chain: Chain;
  caller: string;
  entry: { tsMs: number; px: number };
  exit: { tsMs: number; px: number; reason: string };
  pnl: {
    grossReturnPct: number;
    netReturnPct: number;
    feesUsd: number;
    slippageUsd: number;
  };
};

export function backtestExitStack(input: ExitStackInputs): {
  trade: Trade | null;
  events: BacktestEvent[];
} {
  const { candles, entryTsMs, callId, caller, tokenAddress, chain } = input;

  // Find entry candle (first >= entryTsMs)
  let entryIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    const tsMs = candles[i].timestamp * 1000;
    if (tsMs >= entryTsMs) {
      entryIdx = i;
      break;
    }
  }
  if (entryIdx === -1) return { trade: null, events: [] };

  const entryPx = candles[entryIdx].close;

  const exitSim = simulateExitPlan({
    candles,
    entryTsMs,
    entryPx,
    plan: input.plan as any, // validated already
    taker_fee_bps: input.takerFeeBps,
    slippage_bps: input.slippageBps,
  });

  if (exitSim.fills.length === 0) return { trade: null, events: [] };

  const { netReturnPct, grossReturnPct } = fillsToNetReturnPct({
    positionUsd: input.positionUsd,
    entryPx,
    fills: exitSim.fills,
  });

  // Simple fee/slippage USD breakdown (optional).
  // Your simulateExitPlan already bakes fee+slip into net fill prices,
  // so these are placeholders unless you want a more detailed model.
  const feesUsd = 0;
  const slippageUsd = 0;

  const events: BacktestEvent[] = [
    {
      timestamp: entryTsMs,
      callId,
      tokenAddress,
      price: entryPx,
      event: 'entry',
    },
    ...exitSim.fills.map((f: any) => ({
      timestamp: f.tsMs,
      callId,
      tokenAddress,
      price: f.px,
      event: `exit_${f.reason}`,
    })),
  ];

  const trade: Trade = {
    callId,
    tokenAddress,
    chain,
    caller,
    entry: { tsMs: entryTsMs, px: entryPx },
    exit: { tsMs: exitSim.exitTsMs, px: exitSim.exitPxVwap, reason: exitSim.exitReason },
    pnl: { grossReturnPct, netReturnPct, feesUsd, slippageUsd },
  };

  return { trade, events };
}
