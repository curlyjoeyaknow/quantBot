import type { DateTime } from 'luxon';

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
    info: (...a: Array<unknown>) => void;
    warn: (...a: Array<unknown>) => void;
    error: (...a: Array<unknown>) => void;
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
        fromISO: string;
        toISO: string;
        callerName?: string;
      }) => Promise<void>;
    };
    simulationResults: {
      insertMany: (runId: string, rows: SimulationCallResult[]) => Promise<void>;
    };
  };

  ohlcv: {
    // workflows decide the window; ohlcv decides how to source (cache/db/api)
    getCandles: (q: { mint: string; fromISO: string; toISO: string }) => Promise<Candle[]>;
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
