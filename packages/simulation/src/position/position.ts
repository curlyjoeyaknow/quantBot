/**
 * Position Management
 * ===================
 * Position class for tracking trades and PnL.
 */

import type {
  Position,
  PositionStatus,
  TradeSide,
  TradeExecution,
  UpdatePositionParams,
  PositionSummary,
} from '../types/index.js';
import type { EntryReason, ExitReason } from '../types/position.js';

/**
 * Position creation parameters
 */
export interface CreatePositionParams {
  tokenAddress: string;
  chain: string;
  side?: TradeSide;
  initialSize?: number;
  maxReEntries?: number;
}

/**
 * Entry parameters
 */
export interface EntryParams {
  timestamp: number;
  price: number;
  size: number;
  reason: EntryReason;
  fee?: number;
  slippage?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Exit parameters
 */
export interface ExitParams {
  timestamp: number;
  price: number;
  size: number;
  reason: ExitReason;
  fee?: number;
  slippage?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Simple UUID generator (no dependency)
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create a new position
 */
export function createPosition(params: CreatePositionParams): Position {
  return {
    id: generateId(),
    tokenAddress: params.tokenAddress,
    chain: params.chain,
    side: params.side || 'long',
    status: 'pending',
    openTimestamp: 0,
    averageEntryPrice: 0,
    size: 0,
    maxSize: 0,
    initialSize: params.initialSize ?? 1,
    peakPrice: 0,
    lowestPrice: Infinity,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalFees: 0,
    executions: [],
    ladderLegsExecuted: new Set(),
    reEntryCount: 0,
    maxReEntries: params.maxReEntries ?? 0,
  };
}

/**
 * Execute entry on a position
 */
export function executeEntry(position: Position, params: EntryParams): Position {
  const execution: TradeExecution = {
    id: generateId(),
    timestamp: params.timestamp,
    price: params.price,
    size: params.size,
    action: 'entry',
    reason: params.reason,
    fee: params.fee ?? 0,
    slippage: params.slippage ?? 0,
    metadata: params.metadata,
  };

  const newTotalValue = position.averageEntryPrice * position.size + params.price * params.size;
  const newSize = position.size + params.size;
  const newAverageEntry = newSize > 0 ? newTotalValue / newSize : params.price;

  return {
    ...position,
    status: 'open' as PositionStatus,
    openTimestamp: position.openTimestamp || params.timestamp,
    averageEntryPrice: newAverageEntry,
    size: Math.min(newSize, 1), // Cap at 100%
    maxSize: Math.max(position.maxSize, newSize),
    peakPrice: Math.max(position.peakPrice, params.price),
    lowestPrice: Math.min(position.lowestPrice, params.price),
    totalFees: position.totalFees + execution.fee,
    executions: [...position.executions, execution],
    reEntryCount: params.reason === 're_entry' ? position.reEntryCount + 1 : position.reEntryCount,
  };
}

/**
 * Execute exit on a position
 */
export function executeExit(position: Position, params: ExitParams): Position {
  if (position.size === 0) {
    return position;
  }

  const actualExitSize = Math.min(params.size, position.size);

  const execution: TradeExecution = {
    id: generateId(),
    timestamp: params.timestamp,
    price: params.price,
    size: actualExitSize,
    action: 'exit',
    reason: params.reason,
    fee: params.fee ?? 0,
    slippage: params.slippage ?? 0,
    metadata: params.metadata,
  };

  // Calculate PnL for this exit
  const exitValue = params.price * actualExitSize;
  const entryValue = position.averageEntryPrice * actualExitSize;
  const pnl =
    position.side === 'long'
      ? exitValue - entryValue - execution.fee
      : entryValue - exitValue - execution.fee;

  const newSize = position.size - actualExitSize;
  const isClosed = newSize <= 0;

  return {
    ...position,
    status: isClosed ? ('closed' as PositionStatus) : position.status,
    closeTimestamp: isClosed ? params.timestamp : position.closeTimestamp,
    averageExitPrice: calculateAverageExitPrice(position, params.price, actualExitSize),
    size: Math.max(0, newSize),
    realizedPnl: position.realizedPnl + pnl,
    totalFees: position.totalFees + execution.fee,
    executions: [...position.executions, execution],
  };
}

/**
 * Calculate weighted average exit price
 */
function calculateAverageExitPrice(
  position: Position,
  exitPrice: number,
  exitSize: number
): number {
  const previousExits = position.executions.filter((e) => e.action === 'exit');
  const previousExitValue = previousExits.reduce((sum, e) => sum + e.price * e.size, 0);
  const previousExitSize = previousExits.reduce((sum, e) => sum + e.size, 0);

  const totalExitValue = previousExitValue + exitPrice * exitSize;
  const totalExitSize = previousExitSize + exitSize;

  return totalExitSize > 0 ? totalExitValue / totalExitSize : exitPrice;
}

/**
 * Update position parameters (stop loss, take profit, etc.)
 */
export function updatePosition(position: Position, params: UpdatePositionParams): Position {
  return {
    ...position,
    stopLoss: params.stopLoss ?? position.stopLoss,
    takeProfit: params.takeProfit ?? position.takeProfit,
    trailingStop: params.trailingStop ?? position.trailingStop,
    peakPrice: params.peakPrice ?? position.peakPrice,
    lowestPrice: params.lowestPrice ?? position.lowestPrice,
  };
}

/**
 * Calculate unrealized PnL at current price
 */
export function calculateUnrealizedPnl(position: Position, currentPrice: number): number {
  // Validate inputs to prevent NaN
  if (
    !Number.isFinite(currentPrice) ||
    currentPrice < 0 ||
    !Number.isFinite(position.size) ||
    !Number.isFinite(position.averageEntryPrice) ||
    position.averageEntryPrice < 0
  ) {
    return 0;
  }

  if (position.size === 0) return 0;

  const currentValue = currentPrice * position.size;
  const entryValue = position.averageEntryPrice * position.size;

  const pnl = position.side === 'long' ? currentValue - entryValue : entryValue - currentValue;

  // Ensure result is finite
  if (!Number.isFinite(pnl)) {
    return 0;
  }

  return pnl;
}

/**
 * Calculate total PnL (realized + unrealized)
 */
export function calculateTotalPnl(position: Position, currentPrice: number): number {
  return position.realizedPnl + calculateUnrealizedPnl(position, currentPrice);
}

/**
 * Calculate PnL as percentage
 */
export function calculatePnlPercent(position: Position, currentPrice: number): number {
  if (position.averageEntryPrice === 0 || position.initialSize === 0) return 0;

  const totalPnl = calculateTotalPnl(position, currentPrice);
  const initialValue = position.averageEntryPrice * position.initialSize;

  return (totalPnl / initialValue) * 100;
}

/**
 * Get position summary
 */
export function getPositionSummary(position: Position, currentPrice?: number): PositionSummary {
  const exitPrice = position.averageExitPrice ?? currentPrice ?? position.averageEntryPrice;
  const finalPnl =
    position.status === 'closed' ? position.realizedPnl : calculateTotalPnl(position, exitPrice);

  const holdDuration = position.closeTimestamp
    ? position.closeTimestamp - position.openTimestamp
    : Date.now() / 1000 - position.openTimestamp;

  return {
    tokenAddress: position.tokenAddress,
    chain: position.chain,
    side: position.side,
    entryPrice: position.averageEntryPrice,
    exitPrice: position.averageExitPrice,
    size: position.initialSize,
    pnl: finalPnl,
    pnlPercent:
      position.averageEntryPrice > 0 ? (exitPrice / position.averageEntryPrice - 1) * 100 : 0,
    holdDuration,
    entryCount: position.executions.filter((e) => e.action === 'entry').length,
    exitCount: position.executions.filter((e) => e.action === 'exit').length,
    reEntryCount: position.reEntryCount,
    fees: position.totalFees,
  };
}

/**
 * Check if position is open
 */
export function isPositionOpen(position: Position): boolean {
  return position.status === 'open' && position.size > 0;
}

/**
 * Check if position is closed
 */
export function isPositionClosed(position: Position): boolean {
  return position.status === 'closed' || position.size === 0;
}

/**
 * Check if re-entry is allowed
 */
export function canReEntry(position: Position): boolean {
  return position.reEntryCount < position.maxReEntries;
}
