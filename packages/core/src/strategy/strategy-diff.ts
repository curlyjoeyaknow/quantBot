/**
 * Strategy Diff Algorithm
 *
 * Computes differences between two Strategy DSL objects.
 */

import type { StrategyDSL } from './dsl-schema.js';
import type {
  StrategyDiff,
  FieldDiff,
  EntryDiff,
  ExitDiff,
  ReEntryDiff,
  DiffType,
} from './diff-types.js';

/**
 * Compute diff between two strategies
 */
export function computeStrategyDiff(strategy1: StrategyDSL, strategy2: StrategyDSL): StrategyDiff {
  const diff: StrategyDiff = {
    summary: {
      totalDifferences: 0,
      added: 0,
      removed: 0,
      changed: 0,
      identical: true,
    },
  };

  // Compare top-level fields
  if (strategy1.id !== strategy2.id) {
    diff.id = createFieldDiff('id', strategy1.id, strategy2.id);
    updateSummary(diff.summary, diff.id.type);
  }

  if (strategy1.name !== strategy2.name) {
    diff.name = createFieldDiff('name', strategy1.name, strategy2.name);
    updateSummary(diff.summary, diff.name.type);
  }

  if (strategy1.description !== strategy2.description) {
    diff.description = createFieldDiff('description', strategy1.description, strategy2.description);
    updateSummary(diff.summary, diff.description.type);
  }

  if (!arraysEqual(strategy1.tags || [], strategy2.tags || [])) {
    diff.tags = createFieldDiff('tags', strategy1.tags, strategy2.tags);
    updateSummary(diff.summary, diff.tags.type);
  }

  // Compare position sizing
  if (!objectsEqual(strategy1.positionSizing, strategy2.positionSizing)) {
    diff.positionSizing = createFieldDiff(
      'positionSizing',
      strategy1.positionSizing,
      strategy2.positionSizing
    );
    updateSummary(diff.summary, diff.positionSizing.type);
  }

  // Compare entry configuration
  const entryDiff = compareEntry(strategy1.entry, strategy2.entry);
  if (entryDiff && (entryDiff.type || entryDiff.fields.length > 0)) {
    diff.entry = entryDiff;
    updateSummary(diff.summary, entryDiff.type?.type || 'changed');
    entryDiff.fields.forEach((f) => updateSummary(diff.summary, f.type));
  }

  // Compare exit configuration
  const exitDiff = compareExit(strategy1.exit, strategy2.exit);
  if (exitDiff && exitDiff.conditions.length > 0) {
    diff.exit = exitDiff;
    exitDiff.conditions.forEach((c) => {
      updateSummary(diff.summary, c.type);
      c.diff?.forEach((f) => updateSummary(diff.summary, f.type));
    });
  }

  // Compare re-entry configuration
  if (strategy1.reEntry || strategy2.reEntry) {
    const reEntryDiff = compareReEntry(strategy1.reEntry, strategy2.reEntry);
    if (reEntryDiff && (reEntryDiff.enabled || reEntryDiff.type || reEntryDiff.fields.length > 0)) {
      diff.reEntry = reEntryDiff;
      if (reEntryDiff.enabled) updateSummary(diff.summary, reEntryDiff.enabled.type);
      if (reEntryDiff.type) updateSummary(diff.summary, reEntryDiff.type.type);
      reEntryDiff.fields.forEach((f) => updateSummary(diff.summary, f.type));
    }
  }

  // Compare risk constraints
  if (!objectsEqual(strategy1.risk, strategy2.risk)) {
    diff.risk = createFieldDiff('risk', strategy1.risk, strategy2.risk);
    updateSummary(diff.summary, diff.risk.type);
  }

  // Compare cost configuration
  if (!objectsEqual(strategy1.costs, strategy2.costs)) {
    diff.costs = createFieldDiff('costs', strategy1.costs, strategy2.costs);
    updateSummary(diff.summary, diff.costs.type);
  }

  // Compare metadata
  if (!objectsEqual(strategy1.metadata, strategy2.metadata)) {
    diff.metadata = createFieldDiff('metadata', strategy1.metadata, strategy2.metadata);
    updateSummary(diff.summary, diff.metadata.type);
  }

  diff.summary.identical = diff.summary.totalDifferences === 0;

  return diff;
}

/**
 * Compare entry configurations
 */
function compareEntry(
  entry1: StrategyDSL['entry'],
  entry2: StrategyDSL['entry']
): EntryDiff | null {
  const diff: EntryDiff = {
    fields: [],
  };

  if (entry1.type !== entry2.type) {
    diff.type = createFieldDiff('entry.type', entry1.type, entry2.type);
  }

  // Compare entry-specific fields (simplified - compare entire objects)
  if (!objectsEqual(entry1, entry2)) {
    const fields = compareObjects(entry1, entry2, 'entry');
    diff.fields.push(...fields);
  }

  return diff.type || diff.fields.length > 0 ? diff : null;
}

/**
 * Compare exit configurations
 */
function compareExit(exit1: StrategyDSL['exit'], exit2: StrategyDSL['exit']): ExitDiff | null {
  const diff: ExitDiff = {
    conditions: [],
  };

  const maxLen = Math.max(exit1.length, exit2.length);

  for (let i = 0; i < maxLen; i++) {
    const cond1 = exit1[i];
    const cond2 = exit2[i];

    if (!cond1 && cond2) {
      // Condition added
      diff.conditions.push({
        index: i,
        type: 'added',
        condition: cond2,
      });
    } else if (cond1 && !cond2) {
      // Condition removed
      diff.conditions.push({
        index: i,
        type: 'removed',
        condition: cond1,
      });
    } else if (cond1 && cond2 && !objectsEqual(cond1, cond2)) {
      // Condition changed
      const fieldDiffs = compareObjects(cond1, cond2, `exit[${i}]`);
      diff.conditions.push({
        index: i,
        type: 'changed',
        condition: cond2,
        diff: fieldDiffs,
      });
    }
  }

  return diff.conditions.length > 0 ? diff : null;
}

/**
 * Compare re-entry configurations
 */
function compareReEntry(
  reEntry1: StrategyDSL['reEntry'],
  reEntry2: StrategyDSL['reEntry']
): ReEntryDiff | null {
  const diff: ReEntryDiff = {
    fields: [],
  };

  if (!reEntry1 && reEntry2) {
    diff.enabled = createFieldDiff('reEntry.enabled', false, reEntry2.enabled !== false);
    return diff;
  }

  if (reEntry1 && !reEntry2) {
    diff.enabled = createFieldDiff('reEntry.enabled', reEntry1.enabled !== false, false);
    return diff;
  }

  if (reEntry1 && reEntry2) {
    if (reEntry1.enabled !== reEntry2.enabled) {
      diff.enabled = createFieldDiff('reEntry.enabled', reEntry1.enabled, reEntry2.enabled);
    }

    // Compare re-entry type and fields
    if (reEntry1.type !== reEntry2.type) {
      diff.type = createFieldDiff('reEntry.type', reEntry1.type, reEntry2.type);
    }

    const fields = compareObjects(reEntry1, reEntry2, 'reEntry');
    diff.fields.push(...fields);
  }

  return diff.enabled || diff.type || diff.fields.length > 0 ? diff : null;
}

/**
 * Compare two objects recursively
 */
function compareObjects(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>,
  prefix: string
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const val1 = obj1[key];
    const val2 = obj2[key];

    if (!(key in obj1) && key in obj2) {
      diffs.push(createFieldDiff(path, undefined, val2));
    } else if (key in obj1 && !(key in obj2)) {
      diffs.push(createFieldDiff(path, val1, undefined));
    } else if (!objectsEqual(val1, val2)) {
      if (typeof val1 === 'object' && typeof val2 === 'object' && val1 !== null && val2 !== null) {
        // Recursively compare nested objects
        const nestedDiffs = compareObjects(
          val1 as Record<string, unknown>,
          val2 as Record<string, unknown>,
          path
        );
        diffs.push(...nestedDiffs);
      } else {
        diffs.push(createFieldDiff(path, val1, val2));
      }
    }
  }

  return diffs;
}

/**
 * Create a field diff
 */
function createFieldDiff(path: string, oldValue: unknown, newValue: unknown): FieldDiff {
  if (oldValue === undefined && newValue !== undefined) {
    return { type: 'added', path, newValue };
  }
  if (oldValue !== undefined && newValue === undefined) {
    return { type: 'removed', path, oldValue };
  }
  return { type: 'changed', path, oldValue, newValue };
}

/**
 * Update summary statistics
 */
function updateSummary(summary: StrategyDiff['summary'], type: DiffType): void {
  if (type === 'unchanged') return;

  summary.totalDifferences++;
  if (type === 'added') summary.added++;
  else if (type === 'removed') summary.removed++;
  else if (type === 'changed') summary.changed++;
}

/**
 * Check if two arrays are equal
 */
function arraysEqual<T>(arr1: T[], arr2: T[]): boolean {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((val, idx) => objectsEqual(val, arr2[idx]));
}

/**
 * Check if two values are equal (deep comparison)
 */
function objectsEqual(val1: unknown, val2: unknown): boolean {
  if (val1 === val2) return true;
  if (val1 === null || val2 === null) return val1 === val2;
  if (val1 === undefined || val2 === undefined) return val1 === val2;

  if (Array.isArray(val1) && Array.isArray(val2)) {
    return arraysEqual(val1, val2);
  }

  if (typeof val1 === 'object' && typeof val2 === 'object') {
    const keys1 = Object.keys(val1 as Record<string, unknown>);
    const keys2 = Object.keys(val2 as Record<string, unknown>);
    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (
        !objectsEqual(
          (val1 as Record<string, unknown>)[key],
          (val2 as Record<string, unknown>)[key]
        )
      ) {
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * Calculate similarity score between two strategies (0-1, 1 = identical)
 */
export function calculateSimilarity(strategy1: StrategyDSL, strategy2: StrategyDSL): number {
  const diff = computeStrategyDiff(strategy1, strategy2);
  if (diff.summary.identical) return 1.0;

  // Weight different types of changes
  const totalFields = countFields(strategy1) + countFields(strategy2);
  if (totalFields === 0) return 1.0;

  const unchangedFields = totalFields - diff.summary.totalDifferences;
  return unchangedFields / totalFields;
}

/**
 * Count total fields in a strategy (for similarity calculation)
 */
function countFields(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  if (typeof obj !== 'object') return 1;
  if (Array.isArray(obj)) {
    return obj.reduce((sum: number, item) => sum + countFields(item), 0);
  }

  return Object.values(obj as Record<string, unknown>).reduce(
    (sum: number, val) => sum + countFields(val),
    0
  );
}

/**
 * Format diff as human-readable string
 */
export function formatDiffAsString(diff: StrategyDiff): string {
  const lines: string[] = [];

  if (diff.summary.identical) {
    return 'Strategies are identical';
  }

  lines.push(`Total differences: ${diff.summary.totalDifferences}`);
  lines.push(`  Added: ${diff.summary.added}`);
  lines.push(`  Removed: ${diff.summary.removed}`);
  lines.push(`  Changed: ${diff.summary.changed}`);
  lines.push('');

  if (diff.id) lines.push(formatFieldDiff(diff.id));
  if (diff.name) lines.push(formatFieldDiff(diff.name));
  if (diff.description) lines.push(formatFieldDiff(diff.description));
  if (diff.tags) lines.push(formatFieldDiff(diff.tags));
  if (diff.positionSizing) lines.push(formatFieldDiff(diff.positionSizing));

  if (diff.entry) {
    lines.push('Entry configuration:');
    if (diff.entry.type) lines.push(`  ${formatFieldDiff(diff.entry.type)}`);
    diff.entry.fields.forEach((f) => lines.push(`  ${formatFieldDiff(f)}`));
  }

  if (diff.exit) {
    lines.push('Exit configuration:');
    diff.exit.conditions.forEach((c) => {
      if (c.type === 'added') {
        lines.push(`  [${c.index}] Added: ${JSON.stringify(c.condition)}`);
      } else if (c.type === 'removed') {
        lines.push(`  [${c.index}] Removed: ${JSON.stringify(c.condition)}`);
      } else if (c.type === 'changed' && c.diff) {
        lines.push(`  [${c.index}] Changed:`);
        c.diff.forEach((f) => lines.push(`    ${formatFieldDiff(f)}`));
      }
    });
  }

  if (diff.reEntry) {
    lines.push('Re-entry configuration:');
    if (diff.reEntry.enabled) lines.push(`  ${formatFieldDiff(diff.reEntry.enabled)}`);
    if (diff.reEntry.type) lines.push(`  ${formatFieldDiff(diff.reEntry.type)}`);
    diff.reEntry.fields.forEach((f) => lines.push(`  ${formatFieldDiff(f)}`));
  }

  if (diff.risk) lines.push(formatFieldDiff(diff.risk));
  if (diff.costs) lines.push(formatFieldDiff(diff.costs));
  if (diff.metadata) lines.push(formatFieldDiff(diff.metadata));

  return lines.join('\n');
}

/**
 * Format a single field diff
 */
function formatFieldDiff(field: FieldDiff): string {
  const path = field.path;
  if (field.type === 'added') {
    return `+ ${path}: ${JSON.stringify(field.newValue)}`;
  }
  if (field.type === 'removed') {
    return `- ${path}: ${JSON.stringify(field.oldValue)}`;
  }
  if (field.type === 'changed') {
    return `~ ${path}: ${JSON.stringify(field.oldValue)} → ${JSON.stringify(field.newValue)}`;
  }
  return `${path}: unchanged`;
}
