import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCoverageTimeoutMs,
  getDetailedCoverageTimeoutMs,
  DEFAULT_COVERAGE_TIMEOUT_MS,
  DEFAULT_DETAILED_COVERAGE_TIMEOUT_MS,
} from '../../../src/ohlcv/coverageTimeouts.js';

describe('coverage timeout helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses env override for coverage timeout', () => {
    process.env.OHLCV_COVERAGE_TIMEOUT_MS = '120000';

    expect(getCoverageTimeoutMs()).toBe(120000);
  });

  it('prefers spec timeout over env override', () => {
    process.env.OHLCV_COVERAGE_TIMEOUT_MS = '120000';

    expect(getCoverageTimeoutMs(5000)).toBe(5000);
  });

  it('uses env override for detailed coverage timeout', () => {
    process.env.OHLCV_DETAILED_COVERAGE_TIMEOUT_MS = '240000';

    expect(getDetailedCoverageTimeoutMs()).toBe(240000);
  });

  it('falls back to defaults when no overrides are set', () => {
    delete process.env.OHLCV_COVERAGE_TIMEOUT_MS;
    delete process.env.OHLCV_DETAILED_COVERAGE_TIMEOUT_MS;

    expect(getCoverageTimeoutMs()).toBe(DEFAULT_COVERAGE_TIMEOUT_MS);
    expect(getDetailedCoverageTimeoutMs()).toBe(DEFAULT_DETAILED_COVERAGE_TIMEOUT_MS);
  });
});
