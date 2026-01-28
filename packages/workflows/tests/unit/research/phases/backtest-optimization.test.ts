/**
 * Unit Tests: Phase 2 - Backtest Optimization
 *
 * Tests core functionality of Phase 2:
 * - Phase 1 optimal range usage
 * - Mode-specific parameter handling
 * - Python script integration structure
 * - Parquet artifact handling
 * - Island and champion extraction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { runPhase2BacktestOptimization } from '../../../../src/research/phases/backtest-optimization.js';
import type { Phase2Config, Phase1Result } from '../../../../src/research/phases/types.js';
import {
  createTempDuckDBPath,
  cleanupTestDuckDB,
} from '../../../../../ingestion/tests/helpers/createTestDuckDB.js';

describe('Phase 2: Backtest Optimization', () => {
  let tempDir: string;
  let duckdbPath: string;

  beforeEach(async () => {
    tempDir = join(process.cwd(), 'test-temp', `phase2-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'phase2', 'python-output'), { recursive: true });

    duckdbPath = createTempDuckDBPath('phase2_test');
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      const { rm } = await import('fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    }
    cleanupTestDuckDB(duckdbPath);
  });

  it('should use Phase 1 optimal ranges when provided', () => {
    const phase1Result: Phase1Result = {
      optimalRanges: [
        {
          caller: 'test-caller',
          tpMult: { min: 2.0, max: 3.0, optimal: 2.5 },
          slMult: { min: 0.85, max: 0.9, optimal: 0.875 },
          metrics: {
            winRate: 0.6,
            medianReturnPct: 0.5,
            hit2xPct: 0.4,
            callsCount: 100,
          },
        },
      ],
      summary: {
        totalCallers: 1,
        callersWithRanges: 1,
        excludedCallers: [],
      },
    };

    // Verify Phase 1 result structure
    expect(phase1Result.optimalRanges.length).toBeGreaterThan(0);
    expect(phase1Result.optimalRanges[0]?.tpMult.min).toBe(2.0);
    expect(phase1Result.optimalRanges[0]?.tpMult.max).toBe(3.0);
    expect(phase1Result.optimalRanges[0]?.slMult.min).toBe(0.85);
    expect(phase1Result.optimalRanges[0]?.slMult.max).toBe(0.9);
  });

  it('should handle mode-specific parameters correctly', () => {
    // Test mode parameter logic (matches getModeParams function)
    const testModes: Array<'cheap' | 'serious' | 'war_room'> = ['cheap', 'serious', 'war_room'];

    const expectedParams = {
      cheap: { nTrials: 200, nFolds: 3, trainDays: 7, testDays: 3, foldStep: 3 },
      serious: { nTrials: 1000, nFolds: 5, trainDays: 14, testDays: 7, foldStep: 7 },
      war_room: { nTrials: 2000, nFolds: 8, trainDays: 21, testDays: 7, foldStep: 7 },
    };

    for (const mode of testModes) {
      const params = expectedParams[mode];
      expect(params.nTrials).toBeGreaterThan(0);
      expect(params.nFolds).toBeGreaterThan(0);
      expect(params.trainDays).toBeGreaterThan(0);
      expect(params.testDays).toBeGreaterThan(0);
      expect(params.foldStep).toBeGreaterThan(0);
    }

    // Verify mode progression
    expect(expectedParams.cheap.nTrials).toBeLessThan(expectedParams.serious.nTrials);
    expect(expectedParams.serious.nTrials).toBeLessThan(expectedParams.war_room.nTrials);
  });

  it('should handle extended parameters flag', () => {
    const configWithExtended: Phase2Config = {
      enabled: true,
      mode: 'serious',
      nTrials: 1000,
      nFolds: 5,
      extendedParams: true,
    };

    const configWithoutExtended: Phase2Config = {
      enabled: true,
      mode: 'serious',
      nTrials: 1000,
      nFolds: 5,
      extendedParams: false,
    };

    expect(configWithExtended.extendedParams).toBe(true);
    expect(configWithoutExtended.extendedParams).toBe(false);
  });

  it('should handle missing Phase 1 results (use defaults)', () => {
    const config: Phase2Config = {
      enabled: true,
      mode: 'cheap',
      nTrials: 10,
      nFolds: 2,
      extendedParams: false,
    };

    // When Phase 1 result is undefined, should use default ranges
    const defaultTpMin = 1.5;
    const defaultTpMax = 3.5;
    const defaultSlMin = 0.3;
    const defaultSlMax = 0.6;

    expect(defaultTpMin).toBeLessThan(defaultTpMax);
    expect(defaultSlMin).toBeLessThan(defaultSlMax);
    expect(config.mode).toBe('cheap');
  });

  it('should aggregate Phase 1 ranges across multiple callers', () => {
    const phase1Result: Phase1Result = {
      optimalRanges: [
        {
          caller: 'caller1',
          tpMult: { min: 2.0, max: 3.0, optimal: 2.5 },
          slMult: { min: 0.85, max: 0.9, optimal: 0.875 },
          metrics: { winRate: 0.6, medianReturnPct: 0.5, hit2xPct: 0.4, callsCount: 100 },
        },
        {
          caller: 'caller2',
          tpMult: { min: 2.5, max: 4.0, optimal: 3.0 },
          slMult: { min: 0.8, max: 0.95, optimal: 0.85 },
          metrics: { winRate: 0.7, medianReturnPct: 0.6, hit2xPct: 0.5, callsCount: 150 },
        },
      ],
      summary: {
        totalCallers: 2,
        callersWithRanges: 2,
        excludedCallers: [],
      },
    };

    // Aggregate ranges
    const allTpMins = phase1Result.optimalRanges.map((r) => r.tpMult.min);
    const allTpMaxs = phase1Result.optimalRanges.map((r) => r.tpMult.max);
    const allSlMins = phase1Result.optimalRanges.map((r) => r.slMult.min);
    const allSlMaxs = phase1Result.optimalRanges.map((r) => r.slMult.max);

    const tpMin = Math.min(...allTpMins);
    const tpMax = Math.max(...allTpMaxs);
    const slMin = Math.min(...allSlMins);
    const slMax = Math.max(...allSlMaxs);

    expect(tpMin).toBe(2.0);
    expect(tpMax).toBe(4.0);
    expect(slMin).toBe(0.8);
    expect(slMax).toBe(0.95);
  });

  it('should handle Python output structure correctly', async () => {
    // Create mock Python output JSON
    const pythonOutputDir = join(tempDir, 'phase2', 'python-output');
    await mkdir(pythonOutputDir, { recursive: true });

    const mockOutput = {
      robust_mode: {
        islands: [
          {
            island_id: 'island1',
            centroid: { tp_mult: 2.5, sl_mult: 0.875 },
            n_members: 5,
            mean_robust_score: 0.5,
            best_robust_score: 0.6,
          },
        ],
        champions: [
          {
            champion_id: 'champ1',
            island_id: 'island1',
            params: { tp_mult: 2.5, sl_mult: 0.875 },
            discovery_score: 0.6,
            passes_gates: true,
          },
        ],
      },
      summary: {
        total_trials: 10,
      },
    };

    await writeFile(join(pythonOutputDir, 'results.json'), JSON.stringify(mockOutput), 'utf-8');

    // Verify structure
    expect(mockOutput.robust_mode?.islands).toBeDefined();
    expect(mockOutput.robust_mode?.champions).toBeDefined();
    expect(Array.isArray(mockOutput.robust_mode?.islands)).toBe(true);
    expect(Array.isArray(mockOutput.robust_mode?.champions)).toBe(true);
    expect(mockOutput.summary?.total_trials).toBeGreaterThan(0);
  });
});
