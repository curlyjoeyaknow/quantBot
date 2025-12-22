/**
 * Unit tests for Parity Statistics
 */

import { describe, it, expect } from 'vitest';
import {
  generateParityReport,
  meetsParityGate,
  formatParityReport,
} from '../../src/core/parity-stats.js';
import type { ParityStats } from '../../src/core/dual-run-harness.js';

describe('Parity Statistics', () => {
  const perfectParity: ParityStats = {
    pnlDiff: 0,
    pnlDiffPercent: 0,
    eventCountDiff: 0,
    entryPriceDiff: 0,
    finalPriceDiff: 0,
    metricsDiff: {},
    parityScore: 1.0,
  };

  const goodParity: ParityStats = {
    pnlDiff: 0.001,
    pnlDiffPercent: 0.1,
    eventCountDiff: 0,
    entryPriceDiff: 0.0001,
    finalPriceDiff: 0.0001,
    metricsDiff: { max_drawdown: 0.001 },
    parityScore: 0.995,
  };

  const badParity: ParityStats = {
    pnlDiff: 0.5,
    pnlDiffPercent: 50,
    eventCountDiff: 5,
    entryPriceDiff: 0.1,
    finalPriceDiff: 0.1,
    metricsDiff: { max_drawdown: 0.5, sharpe_ratio: 1.0 },
    parityScore: 0.5,
  };

  describe('generateParityReport', () => {
    it('should generate report from parity stats', () => {
      const stats: ParityStats[] = [perfectParity, goodParity, badParity];
      const report = generateParityReport(stats);

      expect(report.total_runs).toBe(3);
      expect(report.perfect_matches).toBe(1);
      expect(report.within_tolerance).toBe(1);
      expect(report.outside_tolerance).toBe(1);
      expect(report.average_parity_score).toBeCloseTo((1.0 + 0.995 + 0.5) / 3, 3);
      expect(report.worst_parity_score).toBe(0.5);
    });

    it('should handle empty array', () => {
      const report = generateParityReport([]);
      expect(report.total_runs).toBe(0);
      expect(report.perfect_matches).toBe(0);
    });
  });

  describe('meetsParityGate', () => {
    it('should pass when 95%+ have parity >= 0.99', () => {
      const stats: ParityStats[] = [
        perfectParity,
        perfectParity,
        perfectParity,
        goodParity,
        goodParity,
      ]; // 5/5 = 100% passing
      const report = generateParityReport(stats);
      expect(meetsParityGate(report)).toBe(true);
    });

    it('should fail when < 95% have parity >= 0.99', () => {
      const stats: ParityStats[] = [perfectParity, perfectParity, goodParity, badParity, badParity]; // 3/5 = 60% passing
      const report = generateParityReport(stats);
      expect(meetsParityGate(report)).toBe(false);
    });

    it('should fail when average parity < 0.99', () => {
      const stats: ParityStats[] = [goodParity, goodParity, goodParity]; // All 0.995, but average < 0.99 threshold
      const report = generateParityReport(stats);
      // Actually this should pass since all are >= 0.99
      expect(report.average_parity_score).toBeCloseTo(0.995, 3);
      // But let's test with lower scores
      const lowStats: ParityStats[] = [
        { ...goodParity, parityScore: 0.98 },
        { ...goodParity, parityScore: 0.98 },
      ];
      const lowReport = generateParityReport(lowStats);
      expect(meetsParityGate(lowReport)).toBe(false);
    });

    it('should fail for empty report', () => {
      const report = generateParityReport([]);
      expect(meetsParityGate(report)).toBe(false);
    });
  });

  describe('formatParityReport', () => {
    it('should format report as string', () => {
      const stats: ParityStats[] = [perfectParity, goodParity];
      const report = generateParityReport(stats);
      const formatted = formatParityReport(report);

      expect(formatted).toContain('Parity Report');
      expect(formatted).toContain('Total Runs: 2');
      expect(formatted).toContain('Perfect Matches: 1');
      expect(formatted).toContain('Evidence Gate:');
    });
  });
});
