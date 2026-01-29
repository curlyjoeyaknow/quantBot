/**
 * Results Compare Handler
 *
 * Compare two backtest runs side-by-side
 * Pure handler - depends only on ports, no direct I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import { resultsShowHandler } from './results-show.js';

export interface ResultsCompareArgs {
  runId1: string;
  runId2: string;
  format?: 'json' | 'table' | 'csv';
}

export async function resultsCompareHandler(
  args: ResultsCompareArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const { runId1, runId2 } = args;

  // Get both run summaries using the show handler (which uses ports)
  const run1 = await resultsShowHandler({ runId: runId1 }, ctx);
  const run2 = await resultsShowHandler({ runId: runId2 }, ctx);

  // Extract metrics for comparison
  const metrics1 = (run1.metrics as Record<string, unknown>) || {};
  const metrics2 = (run2.metrics as Record<string, unknown>) || {};

  // Build comparison table
  const comparison: Array<{
    metric: string;
    run1: string | number | null;
    run2: string | number | null;
    difference: string | null;
  }> = [];

  const metricKeys = new Set([...Object.keys(metrics1), ...Object.keys(metrics2)]);

  for (const key of metricKeys) {
    const val1 = metrics1[key];
    const val2 = metrics2[key];

    // Skip non-numeric metrics for difference calculation
    if (key === 'createdAt') {
      comparison.push({
        metric: key,
        run1: val1 as string | null,
        run2: val2 as string | null,
        difference: null,
      });
      continue;
    }

    // Parse numeric values (handle percentage strings)
    const parseValue = (val: unknown): number | null => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        // Remove % and parse
        const cleaned = val.replace('%', '').trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
      }
      return null;
    };

    const num1 = parseValue(val1);
    const num2 = parseValue(val2);

    let difference: string | null = null;
    if (num1 !== null && num2 !== null) {
      const diff = num2 - num1;
      const sign = diff >= 0 ? '+' : '';
      difference = `${sign}${diff.toFixed(2)}`;
      if (key.includes('Pct') || key.includes('Rate')) {
        difference += '%';
      }
    }

    comparison.push({
      metric: key,
      run1: val1 as string | number | null,
      run2: val2 as string | number | null,
      difference,
    });
  }

  return {
    runId1,
    runId2,
    comparison,
  };
}
