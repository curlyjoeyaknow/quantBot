/**
 * Portfolio Management
 * ====================
 * Track multiple positions and aggregate metrics.
 */

import type { Position, PositionSummary } from '../types/index.js';
import {
  createPosition,
  executeEntry,
  executeExit,
  calculateTotalPnl,
  getPositionSummary,
  isPositionOpen,
  type CreatePositionParams,
  type EntryParams,
  type ExitParams,
} from './position.js';

/**
 * Portfolio state
 */
export interface Portfolio {
  /** All positions (by ID) */
  positions: Map<string, Position>;
  /** Positions by token address */
  positionsByToken: Map<string, string[]>;
  /** Total realized PnL */
  totalRealizedPnl: number;
  /** Initial capital */
  initialCapital: number;
  /** Current capital (after realized gains/losses) */
  currentCapital: number;
  /** Maximum capital deployed at once */
  maxCapitalDeployed: number;
  /** Total fees paid */
  totalFees: number;
}

/**
 * Portfolio metrics
 */
export interface PortfolioMetrics {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  winners: number;
  losers: number;
  breakeven: number;
  winRate: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalFees: number;
  averagePnl: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number;
}

/**
 * Create a new portfolio
 */
export function createPortfolio(initialCapital: number = 1): Portfolio {
  return {
    positions: new Map(),
    positionsByToken: new Map(),
    totalRealizedPnl: 0,
    initialCapital,
    currentCapital: initialCapital,
    maxCapitalDeployed: 0,
    totalFees: 0,
  };
}

/**
 * Open a new position in the portfolio
 */
export function openPosition(
  portfolio: Portfolio,
  params: CreatePositionParams,
  entryParams: EntryParams
): { portfolio: Portfolio; position: Position } {
  let position = createPosition(params);
  position = executeEntry(position, entryParams);

  const newPortfolio = {
    ...portfolio,
    positions: new Map(portfolio.positions).set(position.id, position),
    positionsByToken: addPositionToToken(
      portfolio.positionsByToken,
      params.tokenAddress,
      position.id
    ),
    totalFees: portfolio.totalFees + (entryParams.fee ?? 0),
  };

  return { portfolio: newPortfolio, position };
}

/**
 * Close a position in the portfolio
 */
export function closePosition(
  portfolio: Portfolio,
  positionId: string,
  exitParams: ExitParams
): { portfolio: Portfolio; position: Position | undefined } {
  const position = portfolio.positions.get(positionId);
  if (!position) {
    return { portfolio, position: undefined };
  }

  const closedPosition = executeExit(position, {
    ...exitParams,
    size: position.size, // Close entire position
  });

  const newPortfolio = {
    ...portfolio,
    positions: new Map(portfolio.positions).set(positionId, closedPosition),
    totalRealizedPnl:
      portfolio.totalRealizedPnl + closedPosition.realizedPnl - position.realizedPnl,
    currentCapital: portfolio.currentCapital + closedPosition.realizedPnl - position.realizedPnl,
    totalFees: portfolio.totalFees + (exitParams.fee ?? 0),
  };

  return { portfolio: newPortfolio, position: closedPosition };
}

/**
 * Partial exit from a position
 */
export function partialExit(
  portfolio: Portfolio,
  positionId: string,
  exitParams: ExitParams
): { portfolio: Portfolio; position: Position | undefined } {
  const position = portfolio.positions.get(positionId);
  if (!position) {
    return { portfolio, position: undefined };
  }

  const updatedPosition = executeExit(position, exitParams);

  const newPortfolio = {
    ...portfolio,
    positions: new Map(portfolio.positions).set(positionId, updatedPosition),
    totalRealizedPnl:
      portfolio.totalRealizedPnl + updatedPosition.realizedPnl - position.realizedPnl,
    currentCapital: portfolio.currentCapital + updatedPosition.realizedPnl - position.realizedPnl,
    totalFees: portfolio.totalFees + (exitParams.fee ?? 0),
  };

  return { portfolio: newPortfolio, position: updatedPosition };
}

/**
 * Get position by ID
 */
export function getPosition(portfolio: Portfolio, positionId: string): Position | undefined {
  return portfolio.positions.get(positionId);
}

/**
 * Get positions by token address
 */
export function getPositionsByToken(portfolio: Portfolio, tokenAddress: string): Position[] {
  const positionIds = portfolio.positionsByToken.get(tokenAddress) ?? [];
  return positionIds
    .map((id) => portfolio.positions.get(id))
    .filter((p): p is Position => p !== undefined);
}

/**
 * Get all open positions
 */
export function getOpenPositions(portfolio: Portfolio): Position[] {
  return Array.from(portfolio.positions.values()).filter(isPositionOpen);
}

/**
 * Get all closed positions
 */
export function getClosedPositions(portfolio: Portfolio): Position[] {
  return Array.from(portfolio.positions.values()).filter((p) => !isPositionOpen(p));
}

/**
 * Calculate portfolio metrics
 */
export function calculatePortfolioMetrics(
  portfolio: Portfolio,
  currentPrices?: Map<string, number>
): PortfolioMetrics {
  const positions = Array.from(portfolio.positions.values());
  const closed = positions.filter((p) => !isPositionOpen(p));
  const open = positions.filter(isPositionOpen);

  const summaries = positions.map((p) => {
    const currentPrice = currentPrices?.get(p.tokenAddress);
    return getPositionSummary(p, currentPrice);
  });

  const pnls = summaries.map((s) => s.pnl);
  const winners = pnls.filter((p) => p > 0);
  const losers = pnls.filter((p) => p < 0);

  const totalGains = winners.reduce((sum, p) => sum + p, 0);
  const totalLosses = Math.abs(losers.reduce((sum, p) => sum + p, 0));

  let unrealizedPnl = 0;
  for (const pos of open) {
    const price = currentPrices?.get(pos.tokenAddress);
    if (price) {
      unrealizedPnl += calculateTotalPnl(pos, price);
    }
  }

  return {
    totalPositions: positions.length,
    openPositions: open.length,
    closedPositions: closed.length,
    winners: winners.length,
    losers: losers.length,
    breakeven: pnls.filter((p) => p === 0).length,
    winRate: pnls.length > 0 ? winners.length / pnls.length : 0,
    totalPnl: pnls.reduce((sum, p) => sum + p, 0),
    realizedPnl: portfolio.totalRealizedPnl,
    unrealizedPnl,
    totalFees: portfolio.totalFees,
    averagePnl: pnls.length > 0 ? pnls.reduce((sum, p) => sum + p, 0) / pnls.length : 0,
    maxWin: Math.max(...winners, 0),
    maxLoss: Math.min(...losers, 0),
    profitFactor: totalLosses > 0 ? totalGains / totalLosses : totalGains > 0 ? Infinity : 0,
  };
}

/**
 * Get all position summaries
 */
export function getAllPositionSummaries(
  portfolio: Portfolio,
  currentPrices?: Map<string, number>
): PositionSummary[] {
  return Array.from(portfolio.positions.values()).map((p) => {
    const currentPrice = currentPrices?.get(p.tokenAddress);
    return getPositionSummary(p, currentPrice);
  });
}

/**
 * Helper to add position ID to token mapping
 */
function addPositionToToken(
  mapping: Map<string, string[]>,
  tokenAddress: string,
  positionId: string
): Map<string, string[]> {
  const newMapping = new Map(mapping);
  const existing = newMapping.get(tokenAddress) ?? [];
  newMapping.set(tokenAddress, [...existing, positionId]);
  return newMapping;
}
