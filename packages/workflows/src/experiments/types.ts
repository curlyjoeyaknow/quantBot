/**
 * Experiment Execution Types
 *
 * Types for experiment execution, simulation integration, and result publishing.
 *
 * @packageDocumentation
 */

// Types are defined inline to avoid circular dependencies

/**
 * Simulation input for experiment execution
 */
export interface SimulationInput {
  /** Path to DuckDB projection */
  duckdbPath: string;

  /** Simulation configuration */
  config: SimulationConfig;

  /** Random seed for determinism */
  seed: number;
}

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  /** Strategy configuration */
  strategy: StrategyConfig;

  /** Date range for simulation */
  dateRange: DateRange;

  /** Additional parameters */
  params: Record<string, unknown>;
}

/**
 * Strategy configuration
 */
export interface StrategyConfig {
  /** Strategy name/type */
  name: string;

  /** Entry configuration */
  entry?: EntryConfig;

  /** Exit configuration */
  exit?: ExitConfig;

  /** Stop loss configuration */
  stopLoss?: StopLossConfig;

  /** Cost configuration */
  costs?: CostConfig;

  /** Additional strategy parameters */
  params?: Record<string, unknown>;
}

/**
 * Entry configuration
 */
export interface EntryConfig {
  /** Entry delay in candles */
  delayCandles?: number;

  /** Entry signal conditions */
  signals?: SignalCondition[];

  /** Additional entry parameters */
  params?: Record<string, unknown>;
}

/**
 * Exit configuration
 */
export interface ExitConfig {
  /** Profit targets */
  targets?: ProfitTarget[];

  /** Exit signal conditions */
  signals?: SignalCondition[];

  /** Timeout in candles */
  timeoutCandles?: number;

  /** Additional exit parameters */
  params?: Record<string, unknown>;
}

/**
 * Stop loss configuration
 */
export interface StopLossConfig {
  /** Stop loss type */
  type: 'fixed' | 'trailing' | 'time' | 'indicator';

  /** Stop loss percentage (for fixed/trailing) */
  percent?: number;

  /** Trailing stop activation multiple */
  trailingActivationMultiple?: number;

  /** Time stop duration in candles */
  timeCandles?: number;

  /** Indicator-based stop configuration */
  indicator?: SignalCondition;

  /** Additional stop loss parameters */
  params?: Record<string, unknown>;
}

/**
 * Cost configuration
 */
export interface CostConfig {
  /** Entry fee percentage */
  entryFee?: number;

  /** Exit fee percentage */
  exitFee?: number;

  /** Slippage percentage */
  slippage?: number;

  /** Borrow rate (annual percentage) */
  borrowRate?: number;

  /** Additional cost parameters */
  params?: Record<string, unknown>;
}

/**
 * Signal condition
 */
export interface SignalCondition {
  /** Indicator name */
  indicator: string;

  /** Condition operator */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'cross_above' | 'cross_below';

  /** Threshold value */
  threshold?: number;

  /** Comparison indicator (for cross conditions) */
  compareIndicator?: string;

  /** Additional signal parameters */
  params?: Record<string, unknown>;
}

/**
 * Profit target
 */
export interface ProfitTarget {
  /** Target multiple (e.g., 2.0 for 2x) */
  target: number;

  /** Percentage of position to exit */
  percent: number;
}

/**
 * Date range
 */
export interface DateRange {
  /** Start date (ISO 8601) */
  from: string;

  /** End date (ISO 8601) */
  to: string;
}

/**
 * Simulation output
 */
export interface SimulationOutput {
  /** Trade records */
  trades: Trade[];

  /** Aggregate metrics */
  metrics: Metrics;

  /** Equity curve points */
  equityCurve: EquityPoint[];

  /** Diagnostics and warnings */
  diagnostics: Diagnostic[];
}

/**
 * Trade record
 */
export interface Trade {
  /** Trade ID */
  tradeId: string;

  /** Alert/call ID */
  callId: string;

  /** Token mint address */
  mint: string;

  /** Entry timestamp (ms) */
  entryTime: number;

  /** Entry price */
  entryPrice: number;

  /** Exit timestamp (ms) */
  exitTime: number;

  /** Exit price */
  exitPrice: number;

  /** Exit reason */
  exitReason: 'target' | 'stop_loss' | 'timeout' | 'signal' | 'final';

  /** Position size */
  size: number;

  /** Gross PnL (before costs) */
  grossPnl: number;

  /** Net PnL (after costs) */
  netPnl: number;

  /** Entry costs */
  entryCosts: number;

  /** Exit costs */
  exitCosts: number;

  /** Borrow costs */
  borrowCosts: number;

  /** Peak multiple achieved */
  peakMultiple: number;

  /** Maximum drawdown from peak */
  maxDrawdown: number;

  /** Duration in milliseconds */
  duration: number;
}

/**
 * Aggregate metrics
 */
export interface Metrics {
  /** Total number of trades */
  totalTrades: number;

  /** Number of winning trades */
  winningTrades: number;

  /** Number of losing trades */
  losingTrades: number;

  /** Win rate (0-1) */
  winRate: number;

  /** Average win */
  avgWin: number;

  /** Average loss */
  avgLoss: number;

  /** Profit factor */
  profitFactor: number;

  /** Total net PnL */
  totalPnl: number;

  /** Total gross PnL */
  totalGrossPnl: number;

  /** Total costs */
  totalCosts: number;

  /** Average trade duration (ms) */
  avgDuration: number;

  /** Maximum drawdown */
  maxDrawdown: number;

  /** Sharpe ratio */
  sharpeRatio: number;

  /** Sortino ratio */
  sortinoRatio: number;

  /** Additional metrics */
  [key: string]: number;
}

/**
 * Equity curve point
 */
export interface EquityPoint {
  /** Timestamp (ms) */
  timestamp: number;

  /** Equity value */
  equity: number;

  /** Cumulative PnL */
  cumulativePnl: number;

  /** Number of open positions */
  openPositions: number;
}

/**
 * Diagnostic message
 */
export interface Diagnostic {
  /** Diagnostic level */
  level: 'info' | 'warning' | 'error';

  /** Diagnostic message */
  message: string;

  /** Timestamp (ms) */
  timestamp: number;

  /** Associated call/trade ID */
  callId?: string;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Simulation results (file paths)
 */
export interface SimulationResults {
  /** Path to trades Parquet file */
  tradesPath: string;

  /** Path to metrics Parquet file */
  metricsPath: string;

  /** Path to equity curve Parquet file */
  curvesPath: string;

  /** Path to diagnostics Parquet file */
  diagnosticsPath?: string;

  /** Input artifact IDs (for lineage) */
  inputArtifactIds: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors */
  errors: ValidationError[];
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Artifact ID */
  artifactId: string;

  /** Error message */
  message: string;

  /** Error type */
  type: 'not_found' | 'invalid_status' | 'invalid_schema' | 'other';
}

