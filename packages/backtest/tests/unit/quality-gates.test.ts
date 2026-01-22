/**
 * Tests for Quality Gates
 *
 * Tests coverage gates, quality score calculation, and enforcement.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateQualityMetrics,
  enforceCoverageGate,
  enforceQualityGate,
  enforceAllQualityGates,
  QualityGateError,
  type QualityMetrics,
  type QualityGateConfig,
} from '../../src/quality-gates.js';

describe('calculateQualityMetrics', () => {
  it('calculates perfect coverage and quality score', () => {
    const metrics = calculateQualityMetrics(1000, 1000, 0, 0, 0);

    expect(metrics.coverage).toBe(1.0);
    expect(metrics.qualityScore).toBe(100);
    expect(metrics.gaps).toBe(0);
    expect(metrics.duplicates).toBe(0);
    expect(metrics.distortions).toBe(0);
  });

  it('calculates coverage correctly', () => {
    const metrics = calculateQualityMetrics(950, 1000, 0, 0, 0);

    expect(metrics.coverage).toBe(0.95);
    expect(metrics.qualityScore).toBe(95);
  });

  it('applies gap penalty', () => {
    const metrics = calculateQualityMetrics(1000, 1000, 10, 0, 0);

    expect(metrics.coverage).toBe(1.0);
    expect(metrics.qualityScore).toBeLessThan(100);
    expect(metrics.qualityScore).toBeGreaterThan(90);
  });

  it('applies duplicate penalty', () => {
    const metrics = calculateQualityMetrics(1000, 1000, 0, 5, 0);

    expect(metrics.coverage).toBe(1.0);
    expect(metrics.qualityScore).toBeLessThan(100);
  });

  it('applies distortion penalty', () => {
    const metrics = calculateQualityMetrics(1000, 1000, 0, 0, 3);

    expect(metrics.coverage).toBe(1.0);
    expect(metrics.qualityScore).toBeLessThan(100);
  });

  it('handles zero expected candles', () => {
    const metrics = calculateQualityMetrics(0, 0, 0, 0, 0);

    expect(metrics.coverage).toBe(0);
    expect(metrics.qualityScore).toBe(0);
  });

  it('caps penalties at maximum', () => {
    // Many gaps should cap at 20 point penalty
    const metrics = calculateQualityMetrics(1000, 1000, 100, 0, 0);

    expect(metrics.qualityScore).toBeGreaterThanOrEqual(80);
  });
});

describe('enforceCoverageGate', () => {
  it('passes when coverage meets threshold', () => {
    const metrics: QualityMetrics = {
      coverage: 0.95,
      qualityScore: 90,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 950,
      expectedCandles: 1000,
    };

    expect(() => enforceCoverageGate(metrics)).not.toThrow();
  });

  it('throws when coverage below threshold', () => {
    const metrics: QualityMetrics = {
      coverage: 0.9,
      qualityScore: 85,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 900,
      expectedCandles: 1000,
    };

    expect(() => enforceCoverageGate(metrics)).toThrow(QualityGateError);
  });

  it('respects custom threshold', () => {
    const metrics: QualityMetrics = {
      coverage: 0.9,
      qualityScore: 85,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 900,
      expectedCandles: 1000,
    };

    const config: QualityGateConfig = {
      minCoverageThreshold: 0.85,
    };

    expect(() => enforceCoverageGate(metrics, config)).not.toThrow();
  });

  it('does not throw when enforceGates is false', () => {
    const metrics: QualityMetrics = {
      coverage: 0.9,
      qualityScore: 85,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 900,
      expectedCandles: 1000,
    };

    const config: QualityGateConfig = {
      enforceGates: false,
    };

    expect(() => enforceCoverageGate(metrics, config)).not.toThrow();
  });
});

describe('enforceQualityGate', () => {
  it('passes when quality score meets threshold', () => {
    const metrics: QualityMetrics = {
      coverage: 0.95,
      qualityScore: 85,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 950,
      expectedCandles: 1000,
    };

    expect(() => enforceQualityGate(metrics)).not.toThrow();
  });

  it('throws when quality score below threshold', () => {
    const metrics: QualityMetrics = {
      coverage: 0.95,
      qualityScore: 75,
      gaps: 10,
      duplicates: 5,
      distortions: 2,
      totalCandles: 950,
      expectedCandles: 1000,
    };

    expect(() => enforceQualityGate(metrics)).toThrow(QualityGateError);
  });

  it('respects custom threshold', () => {
    const metrics: QualityMetrics = {
      coverage: 0.95,
      qualityScore: 75,
      gaps: 10,
      duplicates: 5,
      distortions: 2,
      totalCandles: 950,
      expectedCandles: 1000,
    };

    const config: QualityGateConfig = {
      minQualityScore: 70,
    };

    expect(() => enforceQualityGate(metrics, config)).not.toThrow();
  });
});

describe('enforceAllQualityGates', () => {
  it('passes when all gates are met', () => {
    const metrics: QualityMetrics = {
      coverage: 0.95,
      qualityScore: 85,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 950,
      expectedCandles: 1000,
    };

    expect(() => enforceAllQualityGates(metrics)).not.toThrow();
  });

  it('throws when coverage gate fails', () => {
    const metrics: QualityMetrics = {
      coverage: 0.9,
      qualityScore: 85,
      gaps: 0,
      duplicates: 0,
      distortions: 0,
      totalCandles: 900,
      expectedCandles: 1000,
    };

    expect(() => enforceAllQualityGates(metrics)).toThrow(QualityGateError);
  });

  it('throws when quality gate fails', () => {
    const metrics: QualityMetrics = {
      coverage: 0.95,
      qualityScore: 75,
      gaps: 10,
      duplicates: 5,
      distortions: 2,
      totalCandles: 950,
      expectedCandles: 1000,
    };

    expect(() => enforceAllQualityGates(metrics)).toThrow(QualityGateError);
  });

  it('throws QualityGateError with correct properties', () => {
    const metrics: QualityMetrics = {
      coverage: 0.9,
      qualityScore: 75,
      gaps: 10,
      duplicates: 5,
      distortions: 2,
      totalCandles: 900,
      expectedCandles: 1000,
    };

    const config: QualityGateConfig = {
      minCoverageThreshold: 0.95,
      minQualityScore: 80,
    };

    try {
      enforceAllQualityGates(metrics, config);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(QualityGateError);
      if (error instanceof QualityGateError) {
        expect(error.metrics).toEqual(metrics);
        expect(error.config).toEqual(config);
        expect(error.message).toContain('gate failed');
      }
    }
  });
});
