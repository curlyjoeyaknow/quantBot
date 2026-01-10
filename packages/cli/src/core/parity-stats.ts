/**
 * Parity Statistics
 *
 * Track differences between TypeScript and Python simulators.
 * Generate reports and check if parity meets evidence gate thresholds.
 */

import type { ParityStats } from './dual-run-harness.js';

/**
 * Parity report from multiple dual runs
 */
export interface ParityReport {
  /** Total number of runs */
  total_runs: number;
  /** Number of perfect matches (parityScore === 1.0) */
  perfect_matches: number;
  /** Number within tolerance (parityScore >= 0.99) */
  within_tolerance: number;
  /** Number outside tolerance (parityScore < 0.99) */
  outside_tolerance: number;
  /** Average parity score */
  average_parity_score: number;
  /** Worst parity score */
  worst_parity_score: number;
  /** PnL differences (percent) */
  pnl_differences: number[];
  /** Event count differences */
  event_count_differences: number[];
}

/**
 * Generate parity report from multiple dual runs
 *
 * @param parityStats - Array of parity statistics from dual runs
 * @returns Parity report
 */
export function generateParityReport(parityStats: ParityStats[]): ParityReport {
  if (parityStats.length === 0) {
    return {
      total_runs: 0,
      perfect_matches: 0,
      within_tolerance: 0,
      outside_tolerance: 0,
      average_parity_score: 0,
      worst_parity_score: 0,
      pnl_differences: [],
      event_count_differences: [],
    };
  }

  const perfect = parityStats.filter((p) => p.parityScore === 1.0).length;
  const withinTolerance = parityStats.filter(
    (p) => p.parityScore >= 0.99 && p.parityScore < 1.0
  ).length;
  const outsideTolerance = parityStats.filter((p) => p.parityScore < 0.99).length;

  const avgScore = parityStats.reduce((sum, p) => sum + p.parityScore, 0) / parityStats.length;
  const worstScore = Math.min(...parityStats.map((p) => p.parityScore));

  return {
    total_runs: parityStats.length,
    perfect_matches: perfect,
    within_tolerance: withinTolerance,
    outside_tolerance: outsideTolerance,
    average_parity_score: avgScore,
    worst_parity_score: worstScore,
    pnl_differences: parityStats.map((p) => p.pnlDiffPercent),
    event_count_differences: parityStats.map((p) => p.eventCountDiff),
  };
}

/**
 * Check if parity report meets evidence gate
 *
 * Evidence gate: 95% of runs must have parity score >= 0.99
 *
 * @param report - Parity report
 * @returns True if evidence gate is met
 */
export function meetsParityGate(report: ParityReport): boolean {
  if (report.total_runs === 0) {
    return false;
  }

  const threshold = 0.99;
  const passingRuns = report.perfect_matches + report.within_tolerance;
  const passRate = passingRuns / report.total_runs;

  return passRate >= 0.95 && report.average_parity_score >= threshold;
}

/**
 * Format parity report as human-readable string
 *
 * @param report - Parity report
 * @returns Formatted string
 */
export function formatParityReport(report: ParityReport): string {
  const lines: string[] = [];
  lines.push('Parity Report');
  lines.push('='.repeat(50));
  lines.push(`Total Runs: ${report.total_runs}`);
  lines.push(
    `Perfect Matches: ${report.perfect_matches} (${((report.perfect_matches / report.total_runs) * 100).toFixed(1)}%)`
  );
  lines.push(
    `Within Tolerance: ${report.within_tolerance} (${((report.within_tolerance / report.total_runs) * 100).toFixed(1)}%)`
  );
  lines.push(
    `Outside Tolerance: ${report.outside_tolerance} (${((report.outside_tolerance / report.total_runs) * 100).toFixed(1)}%)`
  );
  lines.push(`Average Parity Score: ${report.average_parity_score.toFixed(4)}`);
  lines.push(`Worst Parity Score: ${report.worst_parity_score.toFixed(4)}`);
  lines.push('');
  lines.push('Evidence Gate: ' + (meetsParityGate(report) ? '✓ PASSED' : '✗ FAILED'));
  return lines.join('\n');
}
