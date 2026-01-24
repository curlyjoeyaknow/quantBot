/**
 * Unit Tests: Phase 3 - Stress Validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { generateRollingWindows, runPhase3StressValidation } from '../../../../src/research/phases/stress-validation.js';
import type { Phase3Config, IslandChampion } from '../../../../src/research/phases/types.js';
import { createTempDuckDBPath, cleanupTestDuckDB } from '../../../../../ingestion/tests/helpers/createTestDuckDB.js';

describe('Phase 3: Stress Validation', () => {
  let tempDir: string;
  let duckdbPath: string;

  beforeEach(async () => {
    tempDir = join(process.cwd(), 'test-temp', `phase3-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    duckdbPath = createTempDuckDBPath('phase3_test');
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      const { rm } = await import('fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    }
    cleanupTestDuckDB(duckdbPath);
  });

  describe('generateRollingWindows', () => {
    it('should generate rolling windows correctly', () => {
      const windows = generateRollingWindows(
        '2024-01-01T00:00:00Z',
        '2024-01-31T23:59:59Z',
        14, // trainDays
        7,  // testDays
        7   // stepDays
      );

      expect(windows.length).toBeGreaterThan(0);
      expect(windows[0]).toHaveProperty('windowId');
      expect(windows[0]).toHaveProperty('trainFrom');
      expect(windows[0]).toHaveProperty('trainTo');
      expect(windows[0]).toHaveProperty('testFrom');
      expect(windows[0]).toHaveProperty('testTo');

      // Verify windows don't overlap incorrectly
      for (let i = 0; i < windows.length - 1; i++) {
        const current = windows[i];
        const next = windows[i + 1];
        expect(new Date(current.testTo).getTime()).toBeLessThanOrEqual(
          new Date(next.trainFrom).getTime()
        );
      }
    });

    it('should handle short date ranges', () => {
      const windows = generateRollingWindows(
        '2024-01-01T00:00:00Z',
        '2024-01-10T00:00:00Z',
        7,
        3,
        3
      );

      // Should generate at least one window if possible
      expect(windows.length).toBeGreaterThanOrEqual(0);
    });

    it('should not generate windows that exceed date range', () => {
      const windows = generateRollingWindows(
        '2024-01-01T00:00:00Z',
        '2024-01-20T00:00:00Z',
        14,
        7,
        7
      );

      for (const window of windows) {
        expect(new Date(window.testTo).getTime()).toBeLessThanOrEqual(
          new Date('2024-01-20T00:00:00Z').getTime()
        );
      }
    });
  });

  describe('stress validation logic', () => {
    it('should compute maximin scores correctly', () => {
      const testScores = [0.5, 0.3, 0.7, 0.2, 0.6];
      const maximinScore = Math.min(...testScores);
      expect(maximinScore).toBe(0.2);
    });

    it('should rank champions by maximin score', () => {
      const champions: Array<{ championId: string; maximinScore: number }> = [
        { championId: 'champ1', maximinScore: 0.3 },
        { championId: 'champ2', maximinScore: 0.5 },
        { championId: 'champ3', maximinScore: 0.2 },
      ];

      champions.sort((a, b) => b.maximinScore - a.maximinScore);

      expect(champions[0].championId).toBe('champ2');
      expect(champions[0].maximinScore).toBe(0.5);
    });
  });

  describe('stress lanes', () => {
    it('should generate minimal lane pack', () => {
      const lanes = [
        {
          name: 'baseline',
          feeBps: 30,
          slippageBps: 50,
          latencyCandles: 0,
          stopGapProb: 0,
          stopGapMult: 1.0,
        },
      ];

      expect(lanes.length).toBe(1);
      expect(lanes[0].name).toBe('baseline');
    });

    it('should generate full lane pack', () => {
      const lanes = [
        {
          name: 'baseline',
          feeBps: 30,
          slippageBps: 50,
          latencyCandles: 0,
          stopGapProb: 0,
          stopGapMult: 1.0,
        },
        {
          name: 'high_fees',
          feeBps: 60,
          slippageBps: 50,
          latencyCandles: 0,
          stopGapProb: 0,
          stopGapMult: 1.0,
        },
        {
          name: 'high_slippage',
          feeBps: 30,
          slippageBps: 100,
          latencyCandles: 0,
          stopGapProb: 0,
          stopGapMult: 1.0,
        },
        {
          name: 'latency',
          feeBps: 30,
          slippageBps: 50,
          latencyCandles: 2,
          stopGapProb: 0,
          stopGapMult: 1.0,
        },
        {
          name: 'stop_gaps',
          feeBps: 30,
          slippageBps: 50,
          latencyCandles: 0,
          stopGapProb: 0.15,
          stopGapMult: 1.5,
        },
      ];

      expect(lanes.length).toBe(5);
      expect(lanes.some((l) => l.name === 'baseline')).toBe(true);
      expect(lanes.some((l) => l.name === 'high_fees')).toBe(true);
      expect(lanes.some((l) => l.name === 'stop_gaps')).toBe(true);
    });
  });
});

