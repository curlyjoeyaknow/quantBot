/**
 * Signal and Indicator Types
 * ==========================
 * Types for indicator-based signal definitions.
 */

/**
 * Supported indicator names
 */
export type IndicatorName =
  | 'rsi'
  | 'macd'
  | 'sma'
  | 'ema'
  | 'vwma'
  | 'bbands'
  | 'atr'
  | 'ichimoku_cloud'
  | 'price_change'
  | 'volume_change'
  | 'custom';

/**
 * Comparison operators
 */
export type ComparisonOperator =
  | '>'
  | '>='
  | '<'
  | '<='
  | '=='
  | '!='
  | 'crosses_above'
  | 'crosses_below';

/**
 * Signal condition
 */
export interface SignalCondition {
  /** Optional ID for tracking */
  id?: string;
  /** Primary indicator */
  indicator: IndicatorName;
  /** Secondary indicator for pairwise conditions */
  secondaryIndicator?: IndicatorName;
  /** Field to compare for primary indicator (e.g., 'value', 'tenkan', 'kijun', 'macd') */
  field?: string;
  /** Field to compare for secondary indicator (e.g., 'signal' for MACD signal line) */
  secondaryField?: string;
  /** Comparison operator */
  operator: ComparisonOperator;
  /** Threshold value */
  value?: number;
  /** Lookback window for conditions like "true in X of last N bars" */
  lookbackBars?: number;
  /** Minimum bars where condition must be true */
  minBarsTrue?: number;
}

/**
 * Signal group (AND/OR combination of conditions)
 */
export interface SignalGroup {
  /** Optional ID for tracking */
  id?: string;
  /** Logic for combining conditions */
  logic: 'AND' | 'OR';
  /** Conditions in this group */
  conditions: SignalCondition[];
  /** Nested groups */
  groups?: SignalGroup[];
}

/**
 * Ladder leg configuration
 */
export interface LadderLeg {
  /** Optional ID for tracking */
  id?: string;
  /** Size of this leg as fraction (0-1) */
  sizePercent: number;
  /** Price offset from entry (e.g., -0.1 for -10%) */
  priceOffset?: number;
  /** Target multiple (e.g., 2 for 2x) */
  multiple?: number;
  /** Signal group that must be satisfied */
  signal?: SignalGroup;
}

/**
 * Ladder configuration
 */
export interface LadderConfig {
  /** Ladder legs */
  legs: LadderLeg[];
  /** Whether legs must execute sequentially */
  sequential: boolean;
}

/**
 * Signal evaluation result for a condition
 */
export interface ConditionResult {
  condition: SignalCondition;
  satisfied: boolean;
  primaryValue?: number;
  secondaryValue?: number;
}

/**
 * Signal evaluation result for a group
 */
export interface GroupResult {
  group: SignalGroup;
  satisfied: boolean;
  children: Array<ConditionResult | GroupResult>;
}

/**
 * Indicator field value
 */
export interface IndicatorFieldValue {
  name: IndicatorName;
  field: string;
  value: number | null;
}

/**
 * Check if result is a condition result
 */
export function isConditionResult(
  result: ConditionResult | GroupResult
): result is ConditionResult {
  return 'condition' in result;
}

/**
 * Check if result is a group result
 */
export function isGroupResult(result: ConditionResult | GroupResult): result is GroupResult {
  return 'group' in result;
}

/**
 * Generate a unique ID for a ladder leg
 */
export function getLadderLegId(leg: LadderLeg): string {
  return leg.id ?? `${leg.sizePercent}:${leg.priceOffset ?? 0}:${leg.multiple ?? 0}`;
}
