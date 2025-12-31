/**
 * Technical Indicators
 *
 * Pure implementations matching Python indicators.py
 * No I/O, no dependencies on external packages.
 */

/**
 * Calculate EMA (Exponential Moving Average)
 *
 * @param values - Array of close prices
 * @param period - EMA period (must be > 0)
 * @returns Array of EMA values (null for indices < period - 1)
 */
export function ema(values: number[], period: number): (number | null)[] {
  if (period <= 0) {
    throw new Error('EMA period must be > 0');
  }

  const out: (number | null)[] = new Array(values.length).fill(null);

  if (values.length === 0) {
    return out;
  }

  const k = 2 / (period + 1);
  let emaPrev: number | null = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      continue; // Already null
    }

    if (i === period - 1) {
      // Seed with SMA
      const sma = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
      emaPrev = sma;
      out[i] = emaPrev;
      continue;
    }

    if (emaPrev === null) {
      throw new Error('EMA calculation error: emaPrev is null');
    }

    emaPrev = (values[i] - emaPrev) * k + emaPrev;
    out[i] = emaPrev;
  }

  return out;
}

/**
 * Calculate RSI (Relative Strength Index)
 *
 * Uses Wilder smoothing method.
 *
 * @param close - Array of close prices
 * @param period - RSI period (must be > 0)
 * @returns Array of RSI values (null for indices < period)
 */
export function rsi(close: number[], period: number): (number | null)[] {
  if (period <= 0) {
    throw new Error('RSI period must be > 0');
  }

  const n = close.length;
  const out: (number | null)[] = new Array(n).fill(null);

  if (n === 0) {
    return out;
  }

  const gains: number[] = new Array(n).fill(0);
  const losses: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const ch = close[i] - close[i - 1];
    gains[i] = Math.max(ch, 0.0);
    losses[i] = Math.max(-ch, 0.0);
  }

  if (n <= period) {
    return out;
  }

  // Wilder smoothing - initial average
  let avgGain = gains.slice(1, period + 1).reduce((sum, v) => sum + v, 0) / period;
  let avgLoss = losses.slice(1, period + 1).reduce((sum, v) => sum + v, 0) / period;

  const calcRsi = (ag: number, al: number): number => {
    if (al === 0) {
      return 100.0;
    }
    const rs = ag / al;
    return 100.0 - 100.0 / (1.0 + rs);
  };

  out[period] = calcRsi(avgGain, avgLoss);

  // Continue with Wilder smoothing
  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i] = calcRsi(avgGain, avgLoss);
  }

  return out;
}
