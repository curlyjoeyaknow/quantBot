/**
 * Strategy Diff Types
 *
 * Defines the structure for representing differences between two strategies.
 */

import type { StrategyDSL } from './dsl-schema.js';

/**
 * Type of change in a field
 */
export type DiffType = 'added' | 'removed' | 'changed' | 'unchanged';

/**
 * Diff for a single field
 */
export interface FieldDiff {
  /** Type of change */
  type: DiffType;
  /** Field path (e.g., 'entry.type', 'exit[0].price') */
  path: string;
  /** Old value (for changed/removed) */
  oldValue?: unknown;
  /** New value (for changed/added) */
  newValue?: unknown;
}

/**
 * Diff for entry configuration
 */
export interface EntryDiff {
  /** Entry type changed */
  type?: FieldDiff;
  /** Entry-specific fields */
  fields: FieldDiff[];
}

/**
 * Diff for exit configuration
 */
export interface ExitDiff {
  /** Exit conditions added/removed/changed */
  conditions: Array<{
    index: number;
    type: DiffType;
    condition?: unknown; // Exit condition object
    diff?: FieldDiff[];
  }>;
}

/**
 * Diff for re-entry configuration
 */
export interface ReEntryDiff {
  /** Re-entry enabled changed */
  enabled?: FieldDiff;
  /** Re-entry type changed */
  type?: FieldDiff;
  /** Re-entry-specific fields */
  fields: FieldDiff[];
}

/**
 * Complete strategy diff
 */
export interface StrategyDiff {
  /** Strategy ID changed */
  id?: FieldDiff;
  /** Strategy name changed */
  name?: FieldDiff;
  /** Strategy description changed */
  description?: FieldDiff;
  /** Strategy tags changed */
  tags?: FieldDiff;
  /** Position sizing changed */
  positionSizing?: FieldDiff;
  /** Entry configuration diff */
  entry?: EntryDiff;
  /** Exit configuration diff */
  exit?: ExitDiff;
  /** Re-entry configuration diff */
  reEntry?: ReEntryDiff;
  /** Risk constraints changed */
  risk?: FieldDiff;
  /** Cost configuration changed */
  costs?: FieldDiff;
  /** Metadata changed */
  metadata?: FieldDiff;
  /** Summary statistics */
  summary: {
    /** Total number of differences */
    totalDifferences: number;
    /** Number of added fields */
    added: number;
    /** Number of removed fields */
    removed: number;
    /** Number of changed fields */
    changed: number;
    /** Whether strategies are identical */
    identical: boolean;
  };
}

/**
 * Strategy comparison result
 */
export interface StrategyComparison {
  /** Strategy 1 */
  strategy1: StrategyDSL;
  /** Strategy 2 */
  strategy2: StrategyDSL;
  /** Diff between strategies */
  diff: StrategyDiff;
  /** Similarity score (0-1, 1 = identical) */
  similarity: number;
}

