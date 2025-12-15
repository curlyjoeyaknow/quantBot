/**
 * Ladder Evaluation
 * =================
 * Evaluate ladder entry/exit legs.
 */

import type { LadderConfig, LadderLeg } from '../types';
import { evaluateSignalGroup, type SignalEvaluationContext } from './evaluator';
import { getLadderLegId } from '../types';

/**
 * Ladder evaluation result
 */
export interface LadderEvaluationResult {
  /** Legs that can be executed */
  executableLegs: LadderLeg[];
  /** Leg IDs that should be marked as executed */
  legIdsToMark: string[];
}

/**
 * Evaluate ladder legs for execution
 */
export function evaluateLadderLegs(
  ladder: LadderConfig,
  context: SignalEvaluationContext,
  alreadyExecutedLegIds: Set<string>
): LadderEvaluationResult {
  const executableLegs: LadderLeg[] = [];
  const legIdsToMark: string[] = [];

  for (const leg of ladder.legs) {
    const legId = getLadderLegId(leg);

    // Skip already executed legs
    if (alreadyExecutedLegIds.has(legId)) {
      continue;
    }

    // If no signal required, leg is executable
    if (!leg.signal) {
      executableLegs.push(leg);
      legIdsToMark.push(legId);

      // If sequential, only execute first available leg
      if (ladder.sequential) {
        break;
      }
      continue;
    }

    // Evaluate signal
    const result = evaluateSignalGroup(leg.signal, context);
    if (result.satisfied) {
      executableLegs.push(leg);
      legIdsToMark.push(legId);

      if (ladder.sequential) {
        break;
      }
    }
  }

  return {
    executableLegs,
    legIdsToMark,
  };
}

/**
 * Calculate ladder entry price
 */
export function calculateLadderEntryPrice(leg: LadderLeg, basePrice: number): number {
  if (leg.priceOffset !== undefined) {
    return basePrice * (1 + leg.priceOffset);
  }
  return basePrice;
}

/**
 * Calculate ladder exit price
 */
export function calculateLadderExitPrice(leg: LadderLeg, entryPrice: number): number {
  if (leg.multiple !== undefined) {
    return entryPrice * leg.multiple;
  }
  if (leg.priceOffset !== undefined) {
    return entryPrice * (1 + leg.priceOffset);
  }
  return entryPrice;
}

/**
 * Get total size of ladder legs
 */
export function getTotalLadderSize(legs: LadderLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.sizePercent, 0);
}

/**
 * Normalize ladder legs to sum to 1
 */
export function normalizeLadderLegs(legs: LadderLeg[]): LadderLeg[] {
  const total = getTotalLadderSize(legs);
  if (total === 0 || total === 1) return legs;

  return legs.map((leg) => ({
    ...leg,
    sizePercent: leg.sizePercent / total,
  }));
}
