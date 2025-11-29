/**
 * Risk Metrics Calculation
 * 
 * Calculates risk metrics (Sharpe ratio, drawdown, etc.)
 */

import { SimulationResult } from '../../simulation/engine';

export interface RiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  volatility: number;
  downsideDeviation: number;
  sortinoRatio: number;
  calmarRatio: number;
}

/**
 * Calculate risk metrics from simulation results
 */
export function calculateRiskMetrics(results: SimulationResult[]): RiskMetrics {
  if (results.length === 0) {
    return {
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      volatility: 0,
      downsideDeviation: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
    };
  }

  // Calculate returns
  const returns = results.map(r => r.finalPnl - 1);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate volatility (standard deviation)
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);

  // Calculate downside deviation (only negative returns)
  const negativeReturns = returns.filter(r => r < 0);
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);

  // Calculate Sharpe ratio (simplified - assumes risk-free rate = 0)
  const sharpeRatio = volatility > 0 ? avgReturn / volatility : 0;

  // Calculate Sortino ratio
  const sortinoRatio = downsideDeviation > 0 ? avgReturn / downsideDeviation : 0;

  // Calculate max drawdown
  let peak = 1;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let cumulative = 1;

  for (const result of results) {
    cumulative *= result.finalPnl;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const drawdown = peak - cumulative;
    const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
  }

  // Calculate Calmar ratio (return / max drawdown)
  const calmarRatio = maxDrawdownPercent > 0 
    ? (avgReturn * 100) / maxDrawdownPercent 
    : 0;

  return {
    sharpeRatio,
    maxDrawdown,
    maxDrawdownPercent,
    volatility,
    downsideDeviation,
    sortinoRatio,
    calmarRatio,
  };
}

