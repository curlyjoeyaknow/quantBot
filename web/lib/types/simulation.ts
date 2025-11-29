/**
 * Simulation Types
 * ================
 * Type definitions for simulation engine and strategies
 */

export interface Strategy {
  percent: number;
  target: number;
}

export interface StopLossConfig {
  initial: number;
  trailing: number | 'none';
}

export interface EntryConfig {
  initialEntry: number | 'none';
  trailingEntry: number | 'none';
  maxWaitTime: number;
}

export interface ReEntryConfig {
  trailingReEntry: number | 'none';
  maxReEntries: number;
  sizePercent: number;
}

export interface SimulationResult {
  finalPnl: number;
  events: SimulationEvent[];
  entryPrice: number;
  finalPrice: number;
  totalCandles: number;
  entryOptimization: {
    lowestPrice: number;
    lowestPriceTimestamp: number;
    lowestPricePercent: number;
    lowestPriceTimeFromEntry: number;
    trailingEntryUsed: boolean;
    actualEntryPrice: number;
    entryDelay: number;
  };
}

export interface SimulationEvent {
  type: 'entry' | 'stop_moved' | 'target_hit' | 'stop_loss' | 'final_exit' | 'trailing_entry_triggered' | 're_entry';
  timestamp: number;
  price: number;
  description: string;
  remainingPosition: number;
  pnlSoFar: number;
}

