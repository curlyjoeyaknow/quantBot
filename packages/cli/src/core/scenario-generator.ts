/**
 * Scenario Generator - Generate deterministic scenario lists for grid searches
 *
 * Provides:
 * - Deterministic scenario IDs (hash of params)
 * - Stable deterministic ordering
 * - Resume support (filter out completed scenarios)
 *
 * This pattern makes grid searches robust, resumable, and predictable.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import type { RunMetadata } from './run-meta.js';

/**
 * Overlay set structure
 */
export interface OverlaySet {
  id?: string;
  overlays: unknown[];
}

/**
 * Scenario definition
 */
export interface Scenario {
  id: string; // Deterministic hash of params
  params: {
    interval: string;
    lagMs: number;
    overlaySetId: string;
    overlaySetIndex: number;
  };
}

/**
 * Generate deterministic scenario ID from params
 *
 * Same params = same ID (useful for deduplication and resume).
 * Uses first 16 characters of SHA256 hash.
 *
 * @param params - Scenario parameters
 * @returns Deterministic scenario ID
 */
function generateScenarioId(params: {
  interval: string;
  lagMs: number;
  overlaySetId: string;
}): string {
  const input = `${params.interval}|${params.lagMs}|${params.overlaySetId}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Generate deterministic scenario list from grid parameters
 *
 * Generates all combinations of intervals × lags × overlaySets.
 * Scenarios are ordered deterministically: interval → lagMs → overlaySetIndex.
 *
 * @param intervals - Array of interval strings (e.g., ['1m', '5m'])
 * @param lagsMs - Array of lag values in milliseconds (e.g., [0, 10000, 30000])
 * @param overlaySets - Array of overlay sets
 * @returns Array of scenarios in deterministic order
 */
export function generateScenarios(
  intervals: string[],
  lagsMs: number[],
  overlaySets: OverlaySet[]
): Scenario[] {
  const scenarios: Scenario[] = [];

  // Sort intervals and lags for deterministic ordering
  const sortedIntervals = [...intervals].sort();
  const sortedLags = [...lagsMs].sort((a, b) => a - b);

  for (const interval of sortedIntervals) {
    for (const lagMs of sortedLags) {
      for (let overlaySetIndex = 0; overlaySetIndex < overlaySets.length; overlaySetIndex++) {
        const overlaySet = overlaySets[overlaySetIndex];
        if (!overlaySet) continue;

        const overlaySetId = overlaySet.id || `set-${overlaySetIndex}`;

        const params = {
          interval,
          lagMs,
          overlaySetId,
          overlaySetIndex,
        };

        const id = generateScenarioId({ interval, lagMs, overlaySetId });

        scenarios.push({ id, params });
      }
    }
  }

  return scenarios;
}

/**
 * Filter out completed scenarios
 *
 * Used for resume support - removes scenarios that have already been completed.
 *
 * @param scenarios - Full scenario list
 * @param completedIds - Array of completed scenario IDs
 * @returns Filtered scenario list (only pending scenarios)
 */
export function filterCompleted(scenarios: Scenario[], completedIds: string[]): Scenario[] {
  const completedSet = new Set(completedIds);
  return scenarios.filter((scenario) => !completedSet.has(scenario.id));
}

/**
 * Load completed scenario IDs from run.meta.json
 *
 * Returns empty array if file doesn't exist or doesn't contain completedScenarioIds.
 *
 * @param metaPath - Path to run.meta.json file
 * @returns Array of completed scenario IDs
 */
export function loadCompletedIds(metaPath: string): string[] {
  if (!existsSync(metaPath)) {
    return [];
  }

  try {
    const content = readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(content) as Partial<RunMetadata>;
    return meta.completedScenarioIds ?? [];
  } catch {
    // If we can't read or parse the file, assume no completed scenarios
    return [];
  }
}
