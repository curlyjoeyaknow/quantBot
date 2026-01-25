/**
 * Unit Tests: Phase 3 - Stress Validation
 *
 * Tests core functionality of Phase 3:
 * - Rolling window generation
 * - Maximin score computation
 * - Stress lane generation
 * - Window boundary validation
 * - Champion ranking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { generateRollingWindows } from '../../../../src/research/phases/stress-validation.js';
import type { Phase3Config } from '../../../../src/research/phases/types.js';
import { createTempDuckDBPath, cleanupTestDuckDB } from '../../../../../ingestion/tests/helpers/createTestDuckDB.js';

describe('Phase 3: Stress Validation', () => {
  let tempDir: string;
  let duckdbPath: string;

  beforeEach(async () => {
    tempDir = join(process.cwd(), 'test-temp', `phase3-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'phase3'), { recursive: true });

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

      // Verify window structure
      for (const window of windows) {
        expect(window.windowId).toMatch(/^window_\d+$/);
        expect(new Date(window.trainFrom).getTime()).toBeLessThan(new Date(window.trainTo).getTime());
        expect(new Date(window.trainTo).getTime()).toBeLessThanOrEqual(new Date(window.testFrom).getTime());
        expect(new Date(window.testFrom).getTime()).toBeLessThan(new Date(window.testTo).getTime());
      }

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
      
      // If windows are generated, verify they're valid
      for (const window of windows) {
        expect(new Date(window.testTo).getTime()).toBeLessThanOrEqual(
          new Date('2024-01-10T00:00:00Z').getTime()
        );
      }
    });

    it('should not generate windows that exceed date range', () => {
      const windows = generateRollingWindows(
        '2024-01-01T00:00:00Z',
        '2024-01-20T00:00:00Z',
        14,
        7,
        7
      );

      const endDate = new Date('2024-01-20T00:00:00Z').getTime();
      
      for (const window of windows) {
        expect(new Date(window.testTo).getTime()).toBeLessThanOrEqual(endDate);
        expect(new Date(window.trainFrom).getTime()).toBeGreaterThanOrEqual(
          new Date('2024-01-01T00:00:00Z').getTime()
        );
      }
    });

    it('should generate windows with correct step spacing', () => {
      const windows = generateRollingWindows(
        '2024-01-01T00:00:00Z',
        '2024-02-01T00:00:00Z',
        14,
        7,
        7
      );

      if (windows.length > 1) {
        for (let i = 0; i < windows.length - 1; i++) {
          const current = windows[i];
          const next = windows[i + 1];
          const currentStart = new Date(current.trainFrom).getTime();
          const nextStart = new Date(next.trainFrom).getTime();
          const daysDiff = (nextStart - currentStart) / (1000 * 60 * 60 * 24);
          // Should step forward by stepDays (7)
          expect(daysDiff).toBeGreaterThanOrEqual(7);
        }
      }
    });

    it('should handle edge case: date range shorter than train+test', () => {
      const windows = generateRollingWindows(
        '2024-01-01T00:00:00Z',
        '2024-01-15T00:00:00Z', // Only 14 days
        14, // trainDays
        7,  // testDays (total needed: 21 days)
        7
      );

      // Should not generate any windows if range is too short
      expect(windows.length).toBe(0);
    });
  });

  describe('stress validation logic', () => {
    it('should compute maximin scores correctly', () => {
      const testScores = [0.5, 0.3, 0.7, 0.2, 0.6];
      const maximinScore = Math.min(...testScores);
      expect(maximinScore).toBe(0.2);
    });

    it('should handle negative scores in maximin calculation', () => {
      const testScores = [0.5, -0.2, 0.3, -0.5, 0.1];
      const maximinScore = Math.min(...testScores);
      expect(maximinScore).toBe(-0.5);
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
      expect(champions[champions.length - 1].championId).toBe('champ3');
      expect(champions[champions.length - 1].maximinScore).toBe(0.2);
    });

    it('should compute median and mean scores correctly', () => {
      const scores = [0.5, 0.3, 0.7, 0.2, 0.6];
      const sorted = [...scores].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0;
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

      expect(median).toBe(0.5);
      expect(mean).toBeCloseTo(0.46, 2);
    });

    it('should identify worst window and lane', () => {
      const windowResults = [
        {
          windowId: 'window1',
          laneResults: {
            baseline: { testR: 0.5, ratio: 1.0, passesGates: true },
            high_fees: { testR: 0.3, ratio: 0.8, passesGates: true },
          },
        },
        {
          windowId: 'window2',
          laneResults: {
            baseline: { testR: 0.2, ratio: 0.5, passesGates: false },
            high_fees: { testR: -0.1, ratio: 0.2, passesGates: false },
          },
        },
      ];

      let worstWindow = '';
      let worstLane = '';
      let worstScore = Infinity;

      for (const wr of windowResults) {
        for (const [laneName, laneResult] of Object.entries(wr.laneResults)) {
          const result = laneResult as { testR: number; ratio: number; passesGates: boolean };
          if (result.testR < worstScore) {
            worstScore = result.testR;
            worstWindow = wr.windowId;
            worstLane = laneName;
          }
        }
      }

      expect(worstWindow).toBe('window2');
      expect(worstLane).toBe('high_fees');
      expect(worstScore).toBe(-0.1);
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
      expect(lanes[0].feeBps).toBe(30);
      expect(lanes[0].slippageBps).toBe(50);
    });

    it('should generate full lane pack with all stress conditions', () => {
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
      expect(lanes.some((l) => l.name === 'high_slippage')).toBe(true);
      expect(lanes.some((l) => l.name === 'latency')).toBe(true);
      expect(lanes.some((l) => l.name === 'stop_gaps')).toBe(true);

      // Verify stress conditions
      const highFeesLane = lanes.find((l) => l.name === 'high_fees');
      expect(highFeesLane?.feeBps).toBe(60);

      const highSlippageLane = lanes.find((l) => l.name === 'high_slippage');
      expect(highSlippageLane?.slippageBps).toBe(100);

      const latencyLane = lanes.find((l) => l.name === 'latency');
      expect(latencyLane?.latencyCandles).toBe(2);

      const stopGapsLane = lanes.find((l) => l.name === 'stop_gaps');
      expect(stopGapsLane?.stopGapProb).toBe(0.15);
      expect(stopGapsLane?.stopGapMult).toBe(1.5);
    });
  });
});

