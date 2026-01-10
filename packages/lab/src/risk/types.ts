/**
 * Risk Engine Types
 *
 * Risk management is separate from strategy logic.
 * Strategy produces intents, risk enforces execution constraints.
 */

/**
 * Position size mode
 */
export type PositionSizeMode = 'fixed_quote';

/**
 * Position size configuration
 */
export interface PositionSizeConfig {
  mode: PositionSizeMode;
  quote: number; // Fixed quote amount
}

/**
 * Stop loss mode
 */
export type StopLossMode = 'fixed_percent' | 'trailing_percent' | 'atr_multiple';

/**
 * Stop loss configuration
 */
export type StopLossConfig =
  | { mode: 'fixed_percent'; percent: number }
  | { mode: 'trailing_percent'; percent: number }
  | { mode: 'atr_multiple'; atr: string; multiple: number }; // atr feature name, multiplier

/**
 * Take profit mode
 */
export type TakeProfitMode = 'fixed_percent' | 'rr_multiple' | 'none';

/**
 * Take profit configuration
 */
export type TakeProfitConfig =
  | { mode: 'fixed_percent'; percent: number }
  | { mode: 'rr_multiple'; rr: number } // Risk-reward ratio
  | { mode: 'none' };

/**
 * Risk configuration
 */
export interface RiskConfig {
  positionSize: PositionSizeConfig;
  stopLoss: StopLossConfig;
  takeProfit: TakeProfitConfig;
  maxHoldMinutes?: number;
  allowReentry?: boolean;
}

/**
 * Position state
 */
export interface Position {
  tokenId: string;
  entryTs: number;
  entryPrice: number;
  size: number; // Quote amount
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPrice?: number;
  maxHoldTs?: number; // Entry ts + maxHoldMinutes
}

/**
 * Risk evaluation result
 */
export interface RiskEvaluation {
  shouldEnter: boolean;
  shouldExit: boolean;
  exitReason?: 'stop_loss' | 'take_profit' | 'max_hold' | 'trailing_stop';
  newStopLossPrice?: number;
  newTakeProfitPrice?: number;
}

/**
 * Market data for risk evaluation
 */
export interface MarketData {
  currentPrice: number;
  high: number;
  low: number;
  atr?: number; // ATR value if available
  ts: number;
}
