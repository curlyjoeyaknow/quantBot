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

/**
 * Backtest engine result - deterministic replay result for a single token.
 * Same inputs → same outputs, no randomness.
 */
export type BacktestEngineResult = {
  pnlMultiplier: number; // e.g. 1.12 means +12%
  trades: number;
};

/**
 * Backtest call result - result for a single call in a backtest run.
 */
export type BacktestCallResult = {
  callId: string;
  mint: string;
  createdAtISO: string;
  ok: boolean;
  pnlMultiplier?: number;
  trades?: number;
  errorCode?: string;
  errorMessage?: string;
};

/**
 * Backtest run specification - parameters for a deterministic backtest.
 * Uses actual historical candles, produces auditable trades + events + replay.
 */
export type BacktestRunSpec = {
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

/**
 * Backtest run result - complete results from a deterministic backtest run.
 */
export type BacktestRunResult = {
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

  results: BacktestCallResult[];
};

/**
 * @deprecated Use BacktestEngineResult instead. This alias will be removed in a future version.
 */
export type SimulationEngineResult = BacktestEngineResult;

/**
 * @deprecated Use BacktestCallResult instead. This alias will be removed in a future version.
 */
export type SimulationCallResult = BacktestCallResult;

/**
 * @deprecated Use BacktestRunSpec instead. This alias will be removed in a future version.
 */
export type SimulationRunSpec = BacktestRunSpec;

/**
 * @deprecated Use BacktestRunResult instead. This alias will be removed in a future version.
 */
export type SimulationRunResult = BacktestRunResult;

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
    backtestRuns: {
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
    backtestResults: {
      insertMany: (runId: string, rows: BacktestCallResult[]) => Promise<void>;
    };
    /**
     * @deprecated Use backtestRuns instead. This alias will be removed in a future version.
     */
    simulationRuns: {
      create: (run: {
        runId: string;
        strategyId: string;
        strategyName: string;
        strategyConfig: unknown;
        fromISO: string;
        toISO: string;
        callerName?: string;
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
    /**
     * @deprecated Use backtestResults instead. This alias will be removed in a future version.
     */
    simulationResults: {
      insertMany: (runId: string, rows: BacktestCallResult[]) => Promise<void>;
    };
  };

  ohlcv: {
    /**
     * Causal candle accessor - ensures Gate 2 compliance (no look-ahead).
     *
     * This is the ONLY way to access candles in simulations.
     * Legacy getCandles() method removed - all candle access must go through causalAccessor.
     *
     * The accessor enforces:
     * - Closed-bar semantics (ts_close <= t_decision)
     * - No future candles accessible
     * - Monotonic time progression
     */
    causalAccessor: CausalCandleAccessor;
  };

  backtest: {
    /**
     * Run a backtest with causal candle access.
     *
     * Deterministic replay over historical data.
     * Same inputs → same outputs, no randomness.
     *
     * CRITICAL: candleAccessor is mandatory - it is structurally impossible to pass raw candles.
     * This enforces Gate 2 compliance: only candles with closeTime <= backtestTime are accessible.
     *
     * Pure compute. If it throws, workflow captures per-call error and continues.
     * Legacy { candles: Candle[] } signature removed - enforce causal accessor usage.
     */
    run: (q: {
      candleAccessor: CausalCandleAccessor; // Mandatory - no raw candles allowed
      mint: string;
      startTime: number;
      endTime: number;
      strategy: StrategyRecord;
      call: CallRecord;
    }) => Promise<BacktestEngineResult>;
  };
  /**
   * @deprecated Use backtest instead. This alias will be removed in a future version.
   */
  simulation: {
    /**
     * @deprecated Use backtest.run instead.
     */
    run: (q: {
      candleAccessor: CausalCandleAccessor;
      mint: string;
      startTime: number;
      endTime: number;
      strategy: StrategyRecord;
      call: CallRecord;
    }) => Promise<BacktestEngineResult>;
  };
};
