/**
 * Indicator Registry
 *
 * Pure functions for computing technical indicators.
 * All indicators are time-causal (only use past data).
 * All feature columns are namespaced (e.g., ema_9, rsi_14).
 */

import type { IndicatorDefinition, IndicatorType } from './types.js';

/**
 * Registry of all supported indicators
 */
export class IndicatorRegistry {
  private indicators: Map<IndicatorType, IndicatorDefinition> = new Map();

  constructor() {
    this.registerDefaultIndicators();
  }

  /**
   * Register an indicator
   */
  register(indicator: IndicatorDefinition): void {
    this.indicators.set(indicator.type, indicator);
  }

  /**
   * Get indicator definition
   */
  get(type: IndicatorType): IndicatorDefinition | undefined {
    return this.indicators.get(type);
  }

  /**
   * List all registered indicator types
   */
  listTypes(): IndicatorType[] {
    return Array.from(this.indicators.keys());
  }

  /**
   * Register default indicators
   */
  private registerDefaultIndicators(): void {
    // SMA (Simple Moving Average)
    this.register({
      type: 'sma',
      name: 'Simple Moving Average',
      generateSQL: (closeColumn, _high, _low, _volume, params) => {
        const period = params.period ?? 20;
        return `AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)`;
      },
      generateName: (params) => {
        const period = params.period ?? 20;
        return `sma_${period}`;
      },
    });

    // EMA (Exponential Moving Average)
    this.register({
      type: 'ema',
      name: 'Exponential Moving Average',
      generateSQL: (closeColumn, _high, _low, _volume, params) => {
        const period = params.period ?? 9;
        const alpha = 2.0 / (period + 1);
        // EMA calculation using recursive window function
        // DuckDB supports recursive CTEs, but for simplicity we use a window-based approximation
        // For exact EMA, we'd need a recursive calculation
        return `AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) * ${alpha} + 
                LAG(AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW), 1, AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)) OVER (PARTITION BY token_id ORDER BY ts) * (1 - ${alpha})`;
      },
      generateName: (params) => {
        const period = params.period ?? 9;
        return `ema_${period}`;
      },
    });

    // RSI (Relative Strength Index)
    this.register({
      type: 'rsi',
      name: 'Relative Strength Index',
      generateSQL: (closeColumn, _high, _low, _volume, params) => {
        const period = params.period ?? 14;
        // RSI = 100 - (100 / (1 + RS))
        // RS = Average Gain / Average Loss
        return `100 - (100 / (1 + 
          NULLIF(
            AVG(CASE WHEN ${closeColumn} > LAG(${closeColumn}, 1) OVER (PARTITION BY token_id ORDER BY ts) 
                     THEN ${closeColumn} - LAG(${closeColumn}, 1) OVER (PARTITION BY token_id ORDER BY ts) 
                     ELSE 0 END) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) /
            NULLIF(
              AVG(CASE WHEN ${closeColumn} < LAG(${closeColumn}, 1) OVER (PARTITION BY token_id ORDER BY ts) 
                       THEN LAG(${closeColumn}, 1) OVER (PARTITION BY token_id ORDER BY ts) - ${closeColumn} 
                       ELSE 0 END) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW),
              0.0001),
            0.0001)))`;
      },
      generateName: (params) => {
        const period = params.period ?? 14;
        return `rsi_${period}`;
      },
    });

    // ATR (Average True Range)
    this.register({
      type: 'atr',
      name: 'Average True Range',
      generateSQL: (_close, highColumn, lowColumn, _volume, params) => {
        const period = params.period ?? 14;
        // True Range = max(high - low, abs(high - prev_close), abs(low - prev_close))
        return `AVG(GREATEST(
          ${highColumn} - ${lowColumn},
          ABS(${highColumn} - LAG(${highColumn}, 1) OVER (PARTITION BY token_id ORDER BY ts)),
          ABS(${lowColumn} - LAG(${lowColumn}, 1) OVER (PARTITION BY token_id ORDER BY ts))
        )) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW)`;
      },
      generateName: (params) => {
        const period = params.period ?? 14;
        return `atr_${period}`;
      },
    });

    // MACD (Moving Average Convergence Divergence)
    this.register({
      type: 'macd',
      name: 'Moving Average Convergence Divergence',
      generateSQL: (closeColumn, _high, _low, _volume, params) => {
        const fastPeriod = params.fastPeriod ?? 12;
        const slowPeriod = params.slowPeriod ?? 26;
        const signalPeriod = params.signalPeriod ?? 9;
        const fastAlpha = 2.0 / (fastPeriod + 1);
        const slowAlpha = 2.0 / (slowPeriod + 1);
        // MACD line = EMA(fast) - EMA(slow)
        // Signal line = EMA(MACD)
        // For simplicity, we compute MACD line only
        // Signal and histogram can be computed separately if needed
        return `(AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${fastPeriod - 1} PRECEDING AND CURRENT ROW) * ${fastAlpha} + 
                LAG(AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${fastPeriod - 1} PRECEDING AND CURRENT ROW), 1, AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${fastPeriod - 1} PRECEDING AND CURRENT ROW)) OVER (PARTITION BY token_id ORDER BY ts) * (1 - ${fastAlpha})) -
                (AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${slowPeriod - 1} PRECEDING AND CURRENT ROW) * ${slowAlpha} + 
                LAG(AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${slowPeriod - 1} PRECEDING AND CURRENT ROW), 1, AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${slowPeriod - 1} PRECEDING AND CURRENT ROW)) OVER (PARTITION BY token_id ORDER BY ts) * (1 - ${slowAlpha}))`;
      },
      generateName: (params) => {
        const fastPeriod = params.fastPeriod ?? 12;
        const slowPeriod = params.slowPeriod ?? 26;
        return `macd_${fastPeriod}_${slowPeriod}`;
      },
    });

    // Bollinger Bands
    this.register({
      type: 'bollinger',
      name: 'Bollinger Bands',
      generateSQL: (closeColumn, _high, _low, _volume, params) => {
        const period = params.period ?? 20;
        const stdDev = params.stdDev ?? 2.0;
        // Upper band = SMA + (stdDev * STDDEV)
        // Lower band = SMA - (stdDev * STDDEV)
        // We return the middle band (SMA) - upper/lower can be computed separately
        return `AVG(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) + 
                (${stdDev} * STDDEV(${closeColumn}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW))`;
      },
      generateName: (params) => {
        const period = params.period ?? 20;
        const stdDev = params.stdDev ?? 2.0;
        return `bb_upper_${period}_${stdDev}`;
      },
    });
  }
}

/**
 * Global indicator registry instance
 */
let globalRegistry: IndicatorRegistry | null = null;

/**
 * Get global indicator registry
 */
export function getIndicatorRegistry(): IndicatorRegistry {
  if (!globalRegistry) {
    globalRegistry = new IndicatorRegistry();
  }
  return globalRegistry;
}
