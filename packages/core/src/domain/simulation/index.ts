/**
 * Simulation Domain Types
 */

import { DateTime } from 'luxon';
import type { Chain } from '../../index.js';
import type { StrategyLeg, StopLossConfig } from '../strategies/index.js';
import type { TokenMetadata } from '../tokens/index.js';

/**
 * Candle type representing OHLCV data for a specific time interval.
 */
export interface Candle {
  timestamp: number; // UNIX timestamp (seconds UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Trade execution
 */
export interface Trade {
  id: string;
  tokenAddress: string;
  chain: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  timestamp: number;
  pnl?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Position state during simulation
 */
export interface Position {
  tokenAddress: string;
  chain: string;
  size: number; // Current position size (positive = long, negative = short)
  entryPrice: number;
  entryTimestamp: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  stopLoss?: number;
  trailingStop?: number;
  profitTargets: Array<{ target: number; percent: number; hit: boolean }>;
}

/**
 * Base fields shared by all simulation events
 */
interface BaseSimulationEvent {
  timestamp: number;
  price: number;
  description: string;
  remainingPosition: number;
  pnlSoFar: number;
  indicators?: Record<string, unknown>;
  positionState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Entry event - initial position entry
 */
export interface EntryEvent extends BaseSimulationEvent {
  type: 'entry';
}

/**
 * Trailing entry triggered event
 */
export interface TrailingEntryTriggeredEvent extends BaseSimulationEvent {
  type: 'trailing_entry_triggered';
}

/**
 * Re-entry event - re-entering after exit
 */
export interface ReEntryEvent extends BaseSimulationEvent {
  type: 're_entry';
}

/**
 * Ladder entry event - partial entry via ladder strategy
 */
export interface LadderEntryEvent extends BaseSimulationEvent {
  type: 'ladder_entry';
}

/**
 * Stop loss moved event - trailing stop activated or moved
 */
export interface StopMovedEvent extends BaseSimulationEvent {
  type: 'stop_moved';
  /** Previous stop loss price (optional) */
  oldStop?: number;
  /** New stop loss price (optional) */
  newStop?: number;
}

/**
 * Target hit event - profit target reached
 */
export interface TargetHitEvent extends BaseSimulationEvent {
  type: 'target_hit';
  /** Target multiplier that was hit (optional) */
  target?: number;
  /** Percentage of position sold (optional) */
  percentSold?: number;
}

/**
 * Stop loss event - stop loss triggered
 */
export interface StopLossEvent extends BaseSimulationEvent {
  type: 'stop_loss';
  /** Stop loss price that was triggered (optional) */
  stopPrice?: number;
}

/**
 * Ladder exit event - partial exit via ladder strategy
 */
export interface LadderExitEvent extends BaseSimulationEvent {
  type: 'ladder_exit';
}

/**
 * Final exit event - complete position exit
 */
export interface FinalExitEvent extends BaseSimulationEvent {
  type: 'final_exit';
  /** Exit reason (optional) */
  exitReason?: string;
}

/**
 * Simulation event - discriminated union of all event types
 *
 * Use type narrowing to access type-specific fields:
 * ```typescript
 * if (event.type === 'target_hit') {
 *   // event.target is available here
 * }
 * ```
 */
export type SimulationEvent =
  | EntryEvent
  | TrailingEntryTriggeredEvent
  | ReEntryEvent
  | LadderEntryEvent
  | StopMovedEvent
  | TargetHitEvent
  | StopLossEvent
  | LadderExitEvent
  | FinalExitEvent;

/**
 * Simulation result
 */
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

/**
 * Simulation aggregate metrics
 */
export interface SimulationAggregate {
  tokenAddress: string;
  chain: string;
  finalPnl: number;
  maxDrawdown: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  winRate: number;
  tradeCount: number;
  reentryCount: number;
  ladderEntriesUsed: number;
  ladderExitsUsed: number;
}

/**
 * Complete simulation trace
 */
export interface SimulationTrace {
  trades: Trade[];
  events: SimulationEvent[];
  aggregates: SimulationAggregate;
}

/**
 * Simulation target for running simulations
 */
export interface SimulationTarget {
  mint: string;
  chain: string;
  startTime: DateTime;
  endTime: DateTime;
  metadata?: Record<string, unknown>;
}

/**
 * Simulation run data structure
 */
export interface SimulationRunData {
  id?: number;
  userId?: number;
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  startTime: DateTime;
  endTime: DateTime;
  strategy: StrategyLeg[];
  stopLossConfig: StopLossConfig;
  finalPnl: number;
  totalCandles: number;
  events: SimulationEvent[];
  strategyName?: string;
  entryType?: string;
  entryPrice?: number;
  entryTimestamp?: number;
  filterCriteria?: Record<string, unknown>;
  createdAt?: DateTime;
}

/**
 * Last simulation info for /repeat command
 */
export interface LastSimulation {
  mint: string;
  chain: string;
  datetime: DateTime;
  metadata: TokenMetadata;
  candles: Candle[];
}

