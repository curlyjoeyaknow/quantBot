/**
 * Validation Split Strategies
 *
 * Implements train/validation split strategies to prevent overfitting:
 * - Time-based: Split by call timestamp (e.g., 80% train, 20% validation)
 * - Caller-based: Split by caller (e.g., 80% of callers train, 20% validation)
 * - Random: Random split (for comparison)
 */

import type { CallRecord } from '../types.js';
import type { DateTime } from 'luxon';

// =============================================================================
// Types
// =============================================================================

export type ValidationSplitStrategy = 'time_based' | 'caller_based' | 'random';

export interface ValidationSplitConfig {
  /** Split strategy */
  strategy: ValidationSplitStrategy;
  /** Train fraction (0-1, e.g., 0.8 = 80% train, 20% validation) */
  trainFraction: number;
  /** Random seed for reproducibility (only used for random strategy) */
  randomSeed?: number;
}

export interface ValidationSplitResult {
  /** Training calls */
  trainCalls: CallRecord[];
  /** Validation calls */
  validationCalls: CallRecord[];
  /** Split metadata */
  metadata: {
    strategy: ValidationSplitStrategy;
    trainFraction: number;
    trainCount: number;
    validationCount: number;
    trainDateRange?: { start: DateTime; end: DateTime };
    validationDateRange?: { start: DateTime; end: DateTime };
    trainCallers?: string[];
    validationCallers?: string[];
  };
}

// =============================================================================
// Split Strategies
// =============================================================================

/**
 * Split calls into train/validation sets using specified strategy
 */
export function splitCalls(
  calls: CallRecord[],
  config: ValidationSplitConfig
): ValidationSplitResult {
  switch (config.strategy) {
    case 'time_based':
      return splitByTime(calls, config.trainFraction);
    case 'caller_based':
      return splitByCaller(calls, config.trainFraction);
    case 'random':
      return splitRandom(calls, config.trainFraction, config.randomSeed);
    default:
      throw new Error(`Unknown split strategy: ${config.strategy}`);
  }
}

/**
 * Time-based split: Split by call timestamp
 *
 * Uses earliest calls for training, latest calls for validation.
 * This simulates real-world scenario where we optimize on historical data
 * and validate on future data.
 */
function splitByTime(calls: CallRecord[], trainFraction: number): ValidationSplitResult {
  // Sort calls by timestamp (earliest first)
  const sortedCalls = [...calls].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());

  const splitIndex = Math.floor(sortedCalls.length * trainFraction);
  const trainCalls = sortedCalls.slice(0, splitIndex);
  const validationCalls = sortedCalls.slice(splitIndex);

  const trainDateRange =
    trainCalls.length > 0
      ? {
          start: trainCalls[0].createdAt,
          end: trainCalls[trainCalls.length - 1].createdAt,
        }
      : undefined;

  const validationDateRange =
    validationCalls.length > 0
      ? {
          start: validationCalls[0].createdAt,
          end: validationCalls[validationCalls.length - 1].createdAt,
        }
      : undefined;

  return {
    trainCalls,
    validationCalls,
    metadata: {
      strategy: 'time_based',
      trainFraction,
      trainCount: trainCalls.length,
      validationCount: validationCalls.length,
      trainDateRange,
      validationDateRange,
    },
  };
}

/**
 * Caller-based split: Split by caller groups
 *
 * Splits callers into train/validation sets. This ensures validation
 * set contains calls from callers not seen during training.
 */
function splitByCaller(calls: CallRecord[], trainFraction: number): ValidationSplitResult {
  // Group calls by caller
  const callsByCaller = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const existing = callsByCaller.get(call.caller) || [];
    existing.push(call);
    callsByCaller.set(call.caller, existing);
  }

  // Get unique callers
  const callers = Array.from(callsByCaller.keys());

  // Sort callers by total call count (for reproducibility)
  callers.sort((a, b) => {
    const countA = callsByCaller.get(a)!.length;
    const countB = callsByCaller.get(b)!.length;
    if (countB !== countA) return countB - countA; // Descending by count
    return a.localeCompare(b); // Then alphabetically
  });

  // Split callers
  const splitIndex = Math.floor(callers.length * trainFraction);
  const trainCallers = callers.slice(0, splitIndex);
  const validationCallers = callers.slice(splitIndex);

  // Collect calls for each set
  const trainCalls: CallRecord[] = [];
  const validationCalls: CallRecord[] = [];

  for (const caller of trainCallers) {
    trainCalls.push(...(callsByCaller.get(caller) || []));
  }

  for (const caller of validationCallers) {
    validationCalls.push(...(callsByCaller.get(caller) || []));
  }

  return {
    trainCalls,
    validationCalls,
    metadata: {
      strategy: 'caller_based',
      trainFraction,
      trainCount: trainCalls.length,
      validationCount: validationCalls.length,
      trainCallers,
      validationCallers,
    },
  };
}

/**
 * Random split: Random assignment of calls to train/validation
 *
 * Uses seed for reproducibility. Useful for comparison with other strategies.
 */
function splitRandom(
  calls: CallRecord[],
  trainFraction: number,
  seed?: number
): ValidationSplitResult {
  // Simple seeded random (linear congruential generator)
  let randomState = seed ?? Date.now();
  function seededRandom(): number {
    randomState = (randomState * 9301 + 49297) % 233280;
    return randomState / 233280;
  }

  // Shuffle calls using seeded random
  const shuffled = [...calls];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const splitIndex = Math.floor(shuffled.length * trainFraction);
  const trainCalls = shuffled.slice(0, splitIndex);
  const validationCalls = shuffled.slice(splitIndex);

  return {
    trainCalls,
    validationCalls,
    metadata: {
      strategy: 'random',
      trainFraction,
      trainCount: trainCalls.length,
      validationCount: validationCalls.length,
    },
  };
}
