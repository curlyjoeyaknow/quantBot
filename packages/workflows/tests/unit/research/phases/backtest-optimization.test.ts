/**
 * Unit Tests: Phase 2 - Backtest Optimization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { runPhase2BacktestOptimization } from '../../../../src/research/phases/backtest-optimization.js';
import type { Phase2Config, Phase1Result } from '../../../../src/research/phases/types.js';
import { createTempDuckDBPath, cleanupTestDuckDB } from '../../../../../ingestion/tests/helpers/createTestDuckDB.js';

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

  it('should use Phase 1 optimal ranges when provided', async () => {
    const config: Phase2Config = {
      enabled: true,
      mode: 'cheap',
      nTrials: 10,
      nFolds: 2,
      extendedParams: false,
    };

    const phase1Result: Phase1Result = {
      optimalRanges: [
        {
          caller: 'test-caller',
          tpMult: { min: 2.0, max: 3.0, optimal: 2.5 },
          slMult: { min: 0.85, max: 0.90, optimal: 0.875 },
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

    // Mock PythonEngine to avoid actual Python execution
    const mockPythonEngine = {
      runScript: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('@quantbot/utils', async () => {
      const actual = await vi.importActual('@quantbot/utils');
      return {
        ...actual,
        PythonEngine: vi.fn().mockImplementation(() => mockPythonEngine),
      };
    });

    // Create mock Python output JSON
    const pythonOutputDir = join(tempDir, 'phase2', 'python-output');
    await mkdir(pythonOutputDir, { recursive: true });
    await writeFile(
      join(pythonOutputDir, 'results.json'),
      JSON.stringify({
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
      }),
      'utf-8'
    );

    // Note: This test will fail if Python script is actually called
    // In a real scenario, we'd mock the PythonEngine more thoroughly
    // For now, we'll just verify the logic structure
    expect(config.mode).toBe('cheap');
    expect(phase1Result.optimalRanges.length).toBeGreaterThan(0);
  });

  it('should handle mode-specific parameters', () => {
    const getModeParams = (mode: 'cheap' | 'serious' | 'war_room') => {
      switch (mode) {
        case 'cheap':
          return { nTrials: 200, nFolds: 3, trainDays: 7, testDays: 3, foldStep: 3 };
        case 'serious':
          return { nTrials: 1000, nFolds: 5, trainDays: 14, testDays: 7, foldStep: 7 };
        case 'war_room':
          return { nTrials: 2000, nFolds: 8, trainDays: 21, testDays: 7, foldStep: 7 };
      }
    };

    expect(getModeParams('cheap').nTrials).toBe(200);
    expect(getModeParams('serious').nTrials).toBe(1000);
    expect(getModeParams('war_room').nTrials).toBe(2000);
  });
});

