/**
 * Dual-Run Harness
 *
 * Runs both TypeScript and Python simulators on the same input and compares results.
 * Used to verify parity between implementations.
 */

import type { SimInput, SimResult } from '@quantbot/simulation';
import { simulateFromInput } from '@quantbot/simulation';
import { execa } from 'execa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parity statistics comparing two simulation results
 */
export interface ParityStats {
  /** Final PnL difference (absolute) */
  pnlDiff: number;
  /** Final PnL difference (relative %) */
  pnlDiffPercent: number;
  /** Event count difference */
  eventCountDiff: number;
  /** Entry price difference */
  entryPriceDiff: number;
  /** Final price difference */
  finalPriceDiff: number;
  /** Metrics differences */
  metricsDiff: Record<string, number>;
  /** Overall parity score (0-1, 1 = identical) */
  parityScore: number;
}

/**
 * Result of dual simulation run
 */
export interface DualRunResult {
  /** TypeScript simulation result */
  tsResult: SimResult;
  /** Python simulation result */
  pythonResult: SimResult;
  /** Parity statistics */
  parity: ParityStats;
}

/**
 * Run simulation with both TS and Python, compare results
 *
 * @param input - Canonical simulation input
 * @returns Dual run result with parity stats
 */
export async function runDualSimulation(input: SimInput): Promise<DualRunResult> {
  // Run TypeScript simulation
  const tsResult = await simulateFromInput(input);

  // Run Python simulation
  const pythonScript = path.resolve(
    __dirname,
    '../../../../tools/telegram/simulation/run_simulation_contract.py'
  );

  try {
    const { stdout } = await execa('python3', [pythonScript], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 300000, // 5 minute timeout
    });

    const pythonResult = JSON.parse(stdout) as SimResult;

    // Calculate parity stats
    const parity = calculateParity(tsResult, pythonResult);

    return { tsResult, pythonResult, parity };
  } catch {
    // If Python simulation fails, return TS result with failed parity
    const failedParity: ParityStats = {
      pnlDiff: Infinity,
      pnlDiffPercent: Infinity,
      eventCountDiff: Infinity,
      entryPriceDiff: Infinity,
      finalPriceDiff: Infinity,
      metricsDiff: {},
      parityScore: 0,
    };

    return {
      tsResult,
      pythonResult: {
        run_id: input.run_id,
        final_pnl: 0,
        events: [],
        entry_price: 0,
        final_price: 0,
        total_candles: input.candles.length,
        metrics: {},
      },
      parity: failedParity,
    };
  }
}

/**
 * Calculate parity statistics between two simulation results
 *
 * @param ts - TypeScript result
 * @param py - Python result
 * @returns Parity statistics
 */
function calculateParity(ts: SimResult, py: SimResult): ParityStats {
  const pnlDiff = Math.abs(ts.final_pnl - py.final_pnl);
  const pnlDiffPercent =
    ts.final_pnl !== 0 ? (pnlDiff / Math.abs(ts.final_pnl)) * 100 : pnlDiff * 100;

  const eventCountDiff = Math.abs(ts.events.length - py.events.length);
  const entryPriceDiff = Math.abs(ts.entry_price - py.entry_price);
  const finalPriceDiff = Math.abs(ts.final_price - py.final_price);

  const metricsDiff: Record<string, number> = {};
  const tsMetrics = ts.metrics;
  const pyMetrics = py.metrics;

  // Compare each metric
  const metricKeys = [
    'max_drawdown',
    'sharpe_ratio',
    'win_rate',
    'total_trades',
    'profit_factor',
    'average_win',
    'average_loss',
  ] as const;

  for (const key of metricKeys) {
    const tsVal = tsMetrics[key];
    const pyVal = pyMetrics[key];
    if (tsVal !== undefined && pyVal !== undefined) {
      metricsDiff[key] = Math.abs(tsVal - pyVal);
    } else if (tsVal !== undefined || pyVal !== undefined) {
      metricsDiff[key] = Infinity; // One is missing
    }
  }

  // Parity score: weighted average of differences
  // 1.0 = identical, 0.0 = completely different
  const pnlWeight = 0.4;
  const eventWeight = 0.2;
  const priceWeight = 0.2;
  const metricsWeight = 0.2;

  // PnL score: < 1% difference = 1.0, > 10% = 0.0
  const pnlScore = pnlDiffPercent < 1 ? 1 : Math.max(0, 1 - pnlDiffPercent / 10);

  // Event score: 0 difference = 1.0, > 5 events difference = 0.0
  const eventScore = eventCountDiff === 0 ? 1 : Math.max(0, 1 - eventCountDiff / 5);

  // Price score: < 0.01% difference = 1.0, else 0.5
  const priceTolerance = 0.0001; // 0.01%
  const entryPriceScore =
    entryPriceDiff < priceTolerance * Math.max(ts.entry_price, py.entry_price) ? 1 : 0.5;
  const finalPriceScore =
    finalPriceDiff < priceTolerance * Math.max(ts.final_price, py.final_price) ? 1 : 0.5;
  const priceScore = (entryPriceScore + finalPriceScore) / 2;

  // Metrics score: all metrics within 0.01 = 1.0, else 0.5
  const metricsValues = Object.values(metricsDiff);
  const metricsScore = metricsValues.length > 0 && metricsValues.every((d) => d < 0.01) ? 1 : 0.5;

  const parityScore =
    pnlScore * pnlWeight +
    eventScore * eventWeight +
    priceScore * priceWeight +
    metricsScore * metricsWeight;

  return {
    pnlDiff,
    pnlDiffPercent,
    eventCountDiff,
    entryPriceDiff,
    finalPriceDiff,
    metricsDiff,
    parityScore,
  };
}
