/**
 * Scenario Generator Tests
 *
 * Tests for deterministic scenario generation, ordering, and resume support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  generateScenarios,
  filterCompleted,
  loadCompletedIds,
  type OverlaySet,
} from '../../../src/core/scenario-generator.js';

const TEST_DIR = join(process.cwd(), '.test-scenario-generator');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('generateScenarios', () => {
  it('generates scenarios for all combinations', () => {
    const intervals = ['1m', '5m'];
    const lagsMs = [0, 10000];
    const overlaySets: OverlaySet[] = [
      { id: 'set-1', overlays: [] },
      { id: 'set-2', overlays: [] },
    ];

    const scenarios = generateScenarios(intervals, lagsMs, overlaySets);

    // 2 intervals × 2 lags × 2 overlay sets = 8 scenarios
    expect(scenarios.length).toBe(8);
  });

  it('generates deterministic scenario IDs', () => {
    const intervals = ['1m'];
    const lagsMs = [0];
    const overlaySets: OverlaySet[] = [{ id: 'set-1', overlays: [] }];

    const scenarios1 = generateScenarios(intervals, lagsMs, overlaySets);
    const scenarios2 = generateScenarios(intervals, lagsMs, overlaySets);

    expect(scenarios1[0]!.id).toBe(scenarios2[0]!.id);
  });

  it('generates different IDs for different params', () => {
    const overlaySets: OverlaySet[] = [{ id: 'set-1', overlays: [] }];

    const scenario1 = generateScenarios(['1m'], [0], overlaySets)[0]!;
    const scenario2 = generateScenarios(['5m'], [0], overlaySets)[0]!;
    const scenario3 = generateScenarios(['1m'], [10000], overlaySets)[0]!;

    expect(scenario1.id).not.toBe(scenario2.id);
    expect(scenario1.id).not.toBe(scenario3.id);
    expect(scenario2.id).not.toBe(scenario3.id);
  });

  it('uses deterministic ordering (interval → lag → overlaySetIndex)', () => {
    const intervals = ['5m', '1m', '1h']; // Intentionally unsorted
    const lagsMs = [30000, 0, 10000]; // Intentionally unsorted
    const overlaySets: OverlaySet[] = [
      { id: 'set-2', overlays: [] },
      { id: 'set-1', overlays: [] },
    ];

    const scenarios = generateScenarios(intervals, lagsMs, overlaySets);

    // Should be sorted: 1h → 1m → 5m (alphabetical), 0 → 10000 → 30000
    expect(scenarios[0]!.params).toMatchObject({
      interval: '1h',
      lagMs: 0,
      overlaySetIndex: 0,
    });
    expect(scenarios[1]!.params).toMatchObject({
      interval: '1h',
      lagMs: 0,
      overlaySetIndex: 1,
    });
    expect(scenarios[2]!.params).toMatchObject({
      interval: '1h',
      lagMs: 10000,
      overlaySetIndex: 0,
    });
  });

  it('uses overlay set ID from set if provided', () => {
    const intervals = ['1m'];
    const lagsMs = [0];
    const overlaySets: OverlaySet[] = [{ id: 'custom-id', overlays: [] }];

    const scenarios = generateScenarios(intervals, lagsMs, overlaySets);

    expect(scenarios[0]!.params.overlaySetId).toBe('custom-id');
  });

  it('generates default overlay set ID if not provided', () => {
    const intervals = ['1m'];
    const lagsMs = [0];
    const overlaySets: OverlaySet[] = [
      { overlays: [] }, // No id
    ];

    const scenarios = generateScenarios(intervals, lagsMs, overlaySets);

    expect(scenarios[0]!.params.overlaySetId).toBe('set-0');
  });

  it('includes overlaySetIndex in params', () => {
    const intervals = ['1m'];
    const lagsMs = [0];
    const overlaySets: OverlaySet[] = [
      { id: 'set-1', overlays: [] },
      { id: 'set-2', overlays: [] },
    ];

    const scenarios = generateScenarios(intervals, lagsMs, overlaySets);

    expect(scenarios[0]!.params.overlaySetIndex).toBe(0);
    expect(scenarios[1]!.params.overlaySetIndex).toBe(1);
  });

  it('handles empty arrays', () => {
    expect(generateScenarios([], [0], [{ overlays: [] }])).toEqual([]);
    expect(generateScenarios(['1m'], [], [{ overlays: [] }])).toEqual([]);
    expect(generateScenarios(['1m'], [0], [])).toEqual([]);
  });

  it('handles single values', () => {
    const scenarios = generateScenarios(['1m'], [0], [{ overlays: [] }]);

    expect(scenarios.length).toBe(1);
    expect(scenarios[0]!.params).toMatchObject({
      interval: '1m',
      lagMs: 0,
      overlaySetIndex: 0,
    });
  });
});

describe('filterCompleted', () => {
  it('filters out completed scenarios', () => {
    const scenarios = [
      {
        id: 'scenario-1',
        params: { interval: '1m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
      {
        id: 'scenario-2',
        params: { interval: '5m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
      {
        id: 'scenario-3',
        params: { interval: '1h', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
    ];
    const completedIds = ['scenario-1', 'scenario-3'];

    const filtered = filterCompleted(scenarios, completedIds);

    expect(filtered.length).toBe(1);
    expect(filtered[0]!.id).toBe('scenario-2');
  });

  it('returns all scenarios if none completed', () => {
    const scenarios = [
      {
        id: 'scenario-1',
        params: { interval: '1m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
      {
        id: 'scenario-2',
        params: { interval: '5m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
    ];
    const completedIds: string[] = [];

    const filtered = filterCompleted(scenarios, completedIds);

    expect(filtered.length).toBe(2);
  });

  it('returns empty array if all completed', () => {
    const scenarios = [
      {
        id: 'scenario-1',
        params: { interval: '1m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
      {
        id: 'scenario-2',
        params: { interval: '5m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
    ];
    const completedIds = ['scenario-1', 'scenario-2'];

    const filtered = filterCompleted(scenarios, completedIds);

    expect(filtered).toEqual([]);
  });

  it('handles empty completed IDs array', () => {
    const scenarios = [
      {
        id: 'scenario-1',
        params: { interval: '1m', lagMs: 0, overlaySetId: 'set-1', overlaySetIndex: 0 },
      },
    ];

    const filtered = filterCompleted(scenarios, []);

    expect(filtered.length).toBe(1);
  });

  it('handles empty scenarios array', () => {
    const filtered = filterCompleted([], ['scenario-1']);

    expect(filtered).toEqual([]);
  });
});

describe('loadCompletedIds', () => {
  it('loads completed scenario IDs from run.meta.json', () => {
    const metaPath = join(TEST_DIR, 'run.meta.json');
    writeFileSync(
      metaPath,
      JSON.stringify({
        sweepId: 'sweep-001',
        completedScenarioIds: ['scenario-1', 'scenario-2'],
      })
    );

    const completedIds = loadCompletedIds(metaPath);

    expect(completedIds).toEqual(['scenario-1', 'scenario-2']);
  });

  it('returns empty array if file does not exist', () => {
    const metaPath = join(TEST_DIR, 'nonexistent.json');

    const completedIds = loadCompletedIds(metaPath);

    expect(completedIds).toEqual([]);
  });

  it('returns empty array if completedScenarioIds field is missing', () => {
    const metaPath = join(TEST_DIR, 'run.meta.json');
    writeFileSync(
      metaPath,
      JSON.stringify({
        sweepId: 'sweep-001',
        // No completedScenarioIds field
      })
    );

    const completedIds = loadCompletedIds(metaPath);

    expect(completedIds).toEqual([]);
  });

  it('returns empty array if file is malformed', () => {
    const metaPath = join(TEST_DIR, 'run.meta.json');
    writeFileSync(metaPath, '{ invalid json }');

    const completedIds = loadCompletedIds(metaPath);

    expect(completedIds).toEqual([]);
  });

  it('handles empty completedScenarioIds array', () => {
    const metaPath = join(TEST_DIR, 'run.meta.json');
    writeFileSync(
      metaPath,
      JSON.stringify({
        sweepId: 'sweep-001',
        completedScenarioIds: [],
      })
    );

    const completedIds = loadCompletedIds(metaPath);

    expect(completedIds).toEqual([]);
  });
});
