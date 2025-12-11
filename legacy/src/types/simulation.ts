/**
 * Simulation and trading strategy types
 */

export interface TradingStrategy {
  name: string;
  description: string;
  takeProfit: TakeProfitTarget[];
  stopLoss: StopLossConfig;
  reentry?: ReentryConfig;
}

export interface TakeProfitTarget {
  percentage: number; // 0-1, portion of position to close
  multiplier: number; // Price multiplier (e.g., 2.0 for 2x)
}

export interface StopLossConfig {
  initial: number; // Initial stop loss percentage (e.g., -0.15 for -15%)
  trailing?: number; // Trailing stop loss percentage
}

export interface ReentryConfig {
  enabled: boolean;
  reentryPriceFactor: number; // Factor for reentry price (e.g., 0.65 for 65% of original)
  reentryStopLoss: number; // Stop loss for reentry position
}

export interface SimulationConfig {
  initialBalance: number;
  positionSize: number;
  slippage: number;
  fees: number;
  tradingRules: TradingStrategy;
}

export interface SimulationResult {
  id: string;
  tokenAddress: string;
  chain: string;
  startTime: Date;
  endTime: Date;
  initialBalance: number;
  finalBalance: number;
  totalPnL: number;
  totalPnLPercent: number;
  trades: Trade[];
  events: SimulationEvent[];
  strategy: TradingStrategy;
}

export interface Trade {
  id: string;
  timestamp: Date;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  value: number;
  reason: string;
}

export interface SimulationEvent {
  timestamp: Date;
  type: 'entry' | 'take_profit' | 'stop_loss' | 'reentry' | 'exit';
  price: number;
  amount: number;
  description: string;
}
