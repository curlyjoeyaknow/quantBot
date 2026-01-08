/**
 * Position and Trade Type Definitions
 * ====================================
 * Types for managing positions and trades in simulations.
 */

/**
 * Trade side (direction)
 */
export type TradeSide = 'long' | 'short';

/**
 * Position status
 */
export type PositionStatus = 'pending' | 'open' | 'closed' | 'liquidated';

/**
 * Entry reason
 */
export type EntryReason = 'signal' | 'initial' | 'trailing' | 'ladder' | 're_entry' | 'dca';

/**
 * Exit reason
 */
export type ExitReason =
  | 'target'
  | 'stop_loss'
  | 'trailing_stop'
  | 'signal'
  | 'ladder'
  | 'timeout'
  | 'manual'
  | 'liquidation';

/**
 * Individual trade execution
 */
export interface TradeExecution {
  /** Unique execution ID */
  id: string;
  /** Execution timestamp (Unix seconds) */
  timestamp: number;
  /** Execution price */
  price: number;
  /** Size executed (0-1 as fraction of position) */
  size: number;
  /** Entry or exit */
  action: 'entry' | 'exit';
  /** Reason for the trade */
  reason: EntryReason | ExitReason;
  /** Fee paid (in quote currency) */
  fee: number;
  /** Slippage experienced */
  slippage: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Position state at a point in time
 */
export interface Position {
  /** Unique position ID */
  id: string;
  /** Token address */
  tokenAddress: string;
  /** Chain identifier */
  chain: string;
  /** Trade direction */
  side: TradeSide;
  /** Current status */
  status: PositionStatus;

  /** Open timestamp */
  openTimestamp: number;
  /** Close timestamp (if closed) */
  closeTimestamp?: number;

  /** Average entry price (weighted by size) */
  averageEntryPrice: number;
  /** Average exit price (if closed) */
  averageExitPrice?: number;

  /** Current size (0-1, remaining position fraction) */
  size: number;
  /** Maximum size held */
  maxSize: number;
  /** Initial position size */
  initialSize: number;

  /** Current stop loss price */
  stopLoss?: number;
  /** Current take profit price */
  takeProfit?: number;
  /** Trailing stop price */
  trailingStop?: number;
  /** Peak price since entry (for trailing stop) */
  peakPrice: number;
  /** Lowest price since entry */
  lowestPrice: number;

  /** Total realized PnL from partial exits */
  realizedPnl: number;
  /** Unrealized PnL at current price */
  unrealizedPnl: number;
  /** Total fees paid */
  totalFees: number;

  /** All trade executions */
  executions: TradeExecution[];

  /** Ladder legs executed (for ladder entry/exit) */
  ladderLegsExecuted: Set<string>;
  /** Re-entry count */
  reEntryCount: number;
  /** Maximum re-entries allowed */
  maxReEntries: number;
}

/**
 * Position update parameters
 */
export interface UpdatePositionParams {
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  peakPrice?: number;
  lowestPrice?: number;
}

/**
 * Position summary for reporting
 */
export interface PositionSummary {
  tokenAddress: string;
  chain: string;
  side: TradeSide;
  entryPrice: number;
  exitPrice?: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  holdDuration: number;
  entryCount: number;
  exitCount: number;
  reEntryCount: number;
  fees: number;
}
