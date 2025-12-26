import type { DateTime } from 'luxon';
import type { CausalCandleAccessor } from '@quantbot/simulation';

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StrategyRecord = {
  id: string;
  name: string;
  // opaque strategy config blob; workflows don't interpret it
  config: unknown;
};

export type CallRecord = {
  id: string;
  caller: string;
  mint: string;
  createdAt: DateTime;
  price_usd?: number; // Entry price from user_calls_d table (optional, may not be available for all calls)
};

export type SimulationEngineResult = {
  pnlMultiplier: number; // e.g. 1.12 means +12%
  trades: number;
};

export type SimulationCallResult = {
  callId: string;
  mint: string;
  createdAtISO: string;
  ok: boolean;
  pnlMultiplier?: number;
  trades?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type SimulationRunSpec = {
  strategyName: string;
  callerName?: string;
  from: DateTime;
  to: DateTime;
  options?: {
    dryRun?: boolean;
    preWindowMinutes?: number;
    postWindowMinutes?: number;
  };
};

export type SimulationRunResult = {
  runId: string;
  strategyName: string;
  callerName?: string;
  fromISO: string;
  toISO: string;
  dryRun: boolean;

  totals: {
    callsFound: number;
    callsAttempted: number;
    callsSucceeded: number;
    callsFailed: number;
    tradesTotal: number;
  };

  pnl: {
    min?: number;
    max?: number;
    mean?: number;
    median?: number;
  };

  results: SimulationCallResult[];
};

export type WorkflowContext = {
  clock: { nowISO(): string };
  ids: { newRunId(): string };
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };

  repos: {
    strategies: { getByName: (name: string) => Promise<StrategyRecord | null> };
    calls: {
      list: (q: { callerName?: string; fromISO: string; toISO: string }) => Promise<CallRecord[]>;
    };
    simulationRuns: {
      create: (run: {
        runId: string;
        strategyId: string;
        strategyName: string;
        strategyConfig: unknown; // Full strategy config for reproducibility
        fromISO: string;
        toISO: string;
        callerName?: string;
        // Aggregate metrics from all calls in the run
        totalCalls?: number;
        successfulCalls?: number;
        failedCalls?: number;
        totalTrades?: number;
        pnlStats?: {
          min?: number;
          max?: number;
          mean?: number;
          median?: number;
        };
      }) => Promise<void>;
    };
    simulationResults: {
      insertMany: (runId: string, rows: SimulationCallResult[]) => Promise<void>;
    };
  };

  ohlcv: {
    // New: Causal accessor (primary) - ensures Gate 2 compliance
    causalAccessor: CausalCandleAccessor;
    // Legacy: Keep for migration period (backward compatibility)
    getCandles?: (q: { mint: string; fromISO: string; toISO: string }) => Promise<Candle[]>;
  };

  simulation: {
    // pure compute. if it throws, workflow captures per-call error and continues.
    run: (q: {
      candles: Candle[];
      strategy: StrategyRecord;
      call: CallRecord;
    }) => Promise<SimulationEngineResult>;
  };
};
