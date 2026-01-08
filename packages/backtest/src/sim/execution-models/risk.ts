/**
 * Risk Framework and Circuit Breakers
 * ====================================
 *
 * Risk management and circuit breaker logic for both simulation and live trading.
 */

import type { CircuitBreakerConfig, AnomalyDetectionConfig, RiskFramework } from './types.js';

/**
 * Circuit breaker state tracker
 */
export interface CircuitBreakerState {
  currentDrawdown: number;
  dailyLoss: number;
  consecutiveLosses: number;
  totalExposure: number;
  strategyExposures: Map<string, number>;
  lastTradeTime: number;
  tradesThisHour: number;
  tradesThisDay: number;
  hourStartTime: number;
  dayStartTime: number;
}

/**
 * Initialize circuit breaker state
 *
 * @param initialTimestamp - Initial timestamp (from candle data or clock port) for determinism
 */
export function createCircuitBreakerState(initialTimestamp?: number): CircuitBreakerState {
  // Use provided timestamp or 0 (will be set on first trade)
  // For determinism, always provide timestamp from candle data
  const now = initialTimestamp ?? 0;
  return {
    currentDrawdown: 0,
    dailyLoss: 0,
    consecutiveLosses: 0,
    totalExposure: 0,
    strategyExposures: new Map(),
    lastTradeTime: 0,
    tradesThisHour: 0,
    tradesThisDay: 0,
    hourStartTime: now,
    dayStartTime: now,
  };
}

/**
 * Check if circuit breaker should trigger
 */
/**
 * Check if circuit breaker should trigger
 *
 * @param config - Circuit breaker configuration
 * @param state - Current circuit breaker state
 * @param currentPnl - Current PnL
 * @param peakPnl - Peak PnL
 * @param strategyId - Strategy ID
 * @param tradeAmount - Trade amount
 * @param now - Current timestamp (from candle data or clock port, required for determinism)
 */
export function checkCircuitBreaker(
  config: CircuitBreakerConfig,
  state: CircuitBreakerState,
  currentPnl: number,
  peakPnl: number,
  strategyId: string,
  tradeAmount: number,
  now: number // Required parameter - no default for determinism
): { triggered: boolean; reason?: string } {
  // Update time windows
  const hourElapsed = now - state.hourStartTime >= 3600_000; // 1 hour
  const dayElapsed = now - state.dayStartTime >= 86400_000; // 24 hours

  if (hourElapsed) {
    state.tradesThisHour = 0;
    state.hourStartTime = now;
  }

  if (dayElapsed) {
    state.tradesThisDay = 0;
    state.dailyLoss = 0;
    state.dayStartTime = now;
  }

  // Calculate drawdown
  const drawdown = peakPnl > 0 ? (peakPnl - currentPnl) / peakPnl : 0;
  state.currentDrawdown = drawdown;

  // Check max drawdown
  if (config.maxDrawdown !== undefined && drawdown > config.maxDrawdown) {
    return { triggered: true, reason: `Max drawdown exceeded: ${(drawdown * 100).toFixed(2)}%` };
  }

  // Check daily loss
  if (currentPnl < 0) {
    state.dailyLoss += Math.abs(currentPnl);
  }
  if (config.maxDailyLoss !== undefined && state.dailyLoss > config.maxDailyLoss) {
    return { triggered: true, reason: `Max daily loss exceeded: ${state.dailyLoss}` };
  }

  // Check consecutive losses
  if (currentPnl < 0) {
    state.consecutiveLosses++;
  } else {
    state.consecutiveLosses = 0;
  }
  if (
    config.maxConsecutiveLosses !== undefined &&
    state.consecutiveLosses >= config.maxConsecutiveLosses
  ) {
    return { triggered: true, reason: `Max consecutive losses: ${state.consecutiveLosses}` };
  }

  // Check exposure limits
  const strategyExposure = (state.strategyExposures.get(strategyId) || 0) + tradeAmount;
  state.strategyExposures.set(strategyId, strategyExposure);

  if (
    config.maxExposurePerStrategy !== undefined &&
    strategyExposure > config.maxExposurePerStrategy
  ) {
    return { triggered: true, reason: `Max exposure per strategy exceeded: ${strategyExposure}` };
  }

  state.totalExposure += tradeAmount;
  if (config.maxTotalExposure !== undefined && state.totalExposure > config.maxTotalExposure) {
    return { triggered: true, reason: `Max total exposure exceeded: ${state.totalExposure}` };
  }

  // Check trade throttles
  if (config.minTradeIntervalSeconds > 0) {
    const timeSinceLastTrade = (now - state.lastTradeTime) / 1000;
    if (timeSinceLastTrade < config.minTradeIntervalSeconds) {
      return {
        triggered: true,
        reason: `Trade throttle: ${timeSinceLastTrade.toFixed(1)}s < ${config.minTradeIntervalSeconds}s`,
      };
    }
  }

  if (config.maxTradesPerHour !== undefined) {
    if (state.tradesThisHour >= config.maxTradesPerHour) {
      return { triggered: true, reason: `Max trades per hour: ${state.tradesThisHour}` };
    }
  }

  if (config.maxTradesPerDay !== undefined) {
    if (state.tradesThisDay >= config.maxTradesPerDay) {
      return { triggered: true, reason: `Max trades per day: ${state.tradesThisDay}` };
    }
  }

  // All checks passed
  state.lastTradeTime = now;
  state.tradesThisHour++;
  state.tradesThisDay++;

  return { triggered: false };
}

/**
 * Anomaly detection state
 */
export interface AnomalyState {
  latencyHistory: number[];
  slippageHistory: number[];
  failureHistory: boolean[];
  windowStartTime: number;
}

/**
 * Initialize anomaly detection state
 *
 * @param initialTimestamp - Initial timestamp (from candle data or clock port) for determinism
 */
export function createAnomalyState(initialTimestamp?: number): AnomalyState {
  // Use provided timestamp or 0 (will be set on first trade)
  // For determinism, always provide timestamp from candle data
  return {
    latencyHistory: [],
    slippageHistory: [],
    failureHistory: [],
    windowStartTime: initialTimestamp ?? 0,
  };
}

/**
 * Check for anomalies
 *
 * @param config - Anomaly detection configuration
 * @param state - Current anomaly state
 * @param latency - Recent latency measurement
 * @param slippage - Recent slippage measurement
 * @param failed - Whether recent trade failed
 * @param expectedLatencyP99 - Expected latency at 99th percentile
 * @param expectedSlippage - Expected slippage
 * @param expectedFailureRate - Expected failure rate
 * @param now - Current timestamp (from candle data or clock port, required for determinism)
 */
export function checkAnomalies(
  config: AnomalyDetectionConfig,
  state: AnomalyState,
  latency: number,
  slippage: number,
  failed: boolean,
  expectedLatencyP99: number,
  expectedSlippage: number,
  expectedFailureRate: number,
  now: number // Required parameter - no default for determinism
): { detected: boolean; anomalies: string[] } {
  if (!config.enabled) {
    return { detected: false, anomalies: [] };
  }

  // Reset window if needed
  if (now - state.windowStartTime >= config.windowSizeSeconds * 1000) {
    state.latencyHistory = [];
    state.slippageHistory = [];
    state.failureHistory = [];
    state.windowStartTime = now;
  }

  const anomalies: string[] = [];

  // Check latency spike
  if (latency > expectedLatencyP99 * config.latencySpikeThreshold) {
    anomalies.push(
      `Latency spike: ${latency}ms > ${expectedLatencyP99 * config.latencySpikeThreshold}ms`
    );
  }

  // Check slippage spike
  if (slippage > expectedSlippage * config.slippageSpikeThreshold) {
    anomalies.push(
      `Slippage spike: ${slippage}bps > ${expectedSlippage * config.slippageSpikeThreshold}bps`
    );
  }

  // Check failure rate spike (over window)
  state.failureHistory.push(failed);
  if (state.failureHistory.length > 100) {
    state.failureHistory.shift(); // Keep last 100 samples
  }
  const recentFailureRate =
    state.failureHistory.filter(Boolean).length / state.failureHistory.length;
  if (recentFailureRate > expectedFailureRate * config.failureRateSpikeThreshold) {
    anomalies.push(
      `Failure rate spike: ${(recentFailureRate * 100).toFixed(2)}% > ${(expectedFailureRate * config.failureRateSpikeThreshold * 100).toFixed(2)}%`
    );
  }

  return {
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * Create default risk framework
 */
export function createDefaultRiskFramework(): RiskFramework {
  return {
    circuitBreakers: {
      maxDrawdown: 0.2, // 20% max drawdown
      maxDailyLoss: 1000, // $1000 max daily loss
      maxConsecutiveLosses: 5,
      maxExposurePerStrategy: 5000, // $5000 per strategy
      maxTotalExposure: 20000, // $20k total
      minTradeIntervalSeconds: 1,
      maxTradesPerHour: 100,
      maxTradesPerDay: 500,
    },
    anomalyDetection: {
      enabled: true,
      latencySpikeThreshold: 3,
      slippageSpikeThreshold: 3,
      failureRateSpikeThreshold: 3,
      windowSizeSeconds: 300,
    },
  };
}
