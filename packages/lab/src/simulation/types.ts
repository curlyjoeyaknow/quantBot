/**
 * Simulation Types
 *
 * Types for deterministic, research-grade simulation.
 */

/**
 * Simulation event types
 */
export type SimulationEventType =
  | 'entry'
  | 'exit'
  | 'stop_loss'
  | 'take_profit'
  | 'max_hold'
  | 'trailing_stop'
  | 'final_exit';

/**
 * Simulation event
 */
export interface SimulationEvent {
  type: SimulationEventType;
  tokenId: string;
  ts: number;
  price: number;
  size?: number;
  pnl?: number;
  pnlSoFar?: number;
  reason?: string;
}

/**
 * Fill event (trade execution)
 */
export interface FillEvent {
  tokenId: string;
  ts: number;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  quoteAmount: number;
  fees: number;
}

/**
 * Position state at a point in time
 */
export interface PositionSnapshot {
  tokenId: string;
  ts: number;
  entryTs: number;
  entryPrice: number;
  currentPrice: number;
  size: number;
  unrealizedPnl: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPrice?: number;
}

/**
 * Simulation state
 */
export interface SimulationState {
  capital: number;
  positions: Map<string, PositionSnapshot>; // tokenId -> position
  totalPnl: number;
  events: SimulationEvent[];
  fills: FillEvent[];
}

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  initialCapital: number;
  costConfig: {
    entrySlippageBps: number;
    exitSlippageBps: number;
    takerFeeBps: number;
    borrowAprBps: number;
  };
}
