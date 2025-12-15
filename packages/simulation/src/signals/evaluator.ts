/**
 * Signal Evaluator
 * ================
 * Evaluate signal conditions and groups.
 */

import type { SignalCondition, SignalGroup, IndicatorName, ComparisonOperator } from '../types';
import type { Candle } from '../types/candle';
import type { LegacyIndicatorData } from '../indicators/registry';

/**
 * Signal evaluation context
 */
export interface SignalEvaluationContext {
  /** Current candle */
  candle: Candle;
  /** Current indicators */
  indicators: LegacyIndicatorData;
  /** Previous indicators (for cross conditions) */
  prevIndicators?: LegacyIndicatorData | null;
  /** Position state (for advanced conditions) */
  positionState?: Record<string, unknown>;
}

/**
 * Condition evaluation result
 */
export interface ConditionEvaluationResult {
  condition: SignalCondition;
  satisfied: boolean;
  primaryValue?: number;
  secondaryValue?: number;
}

/**
 * Group evaluation result
 */
export interface GroupEvaluationResult {
  group: SignalGroup;
  satisfied: boolean;
  children: Array<ConditionEvaluationResult | GroupEvaluationResult>;
}

/**
 * Evaluate a signal group with support for lookback windows
 */
export function evaluateSignalGroup(
  group: SignalGroup,
  context: SignalEvaluationContext,
  lookbackContext?: {
    candles: readonly Candle[];
    indicators: readonly LegacyIndicatorData[];
    currentIndex: number;
  }
): GroupEvaluationResult {
  const children: Array<ConditionEvaluationResult | GroupEvaluationResult> = [];

  // Evaluate conditions
  for (const condition of group.conditions ?? []) {
    // Check if condition has lookback requirements
    if (condition.lookbackBars && condition.minBarsTrue && lookbackContext) {
      const lookbackResult = evaluateConditionWithLookback(condition, context, lookbackContext);
      children.push(lookbackResult);
    } else {
      const result = evaluateCondition(condition, context);
      children.push(result);
    }
  }

  // Evaluate nested groups
  for (const childGroup of group.groups ?? []) {
    const result = evaluateSignalGroup(childGroup, context, lookbackContext);
    children.push(result);
  }

  // Aggregate results
  const satisfied = aggregateResults(group.logic, children);

  return {
    group,
    satisfied,
    children,
  };
}

/**
 * Evaluate condition with lookback window (X of Y bars must be true)
 */
function evaluateConditionWithLookback(
  condition: SignalCondition,
  context: SignalEvaluationContext,
  lookbackContext: {
    candles: readonly Candle[];
    indicators: readonly LegacyIndicatorData[];
    currentIndex: number;
  }
): ConditionEvaluationResult {
  const { lookbackBars = 0, minBarsTrue = 0 } = condition;
  const { candles, indicators, currentIndex } = lookbackContext;

  if (currentIndex < lookbackBars - 1) {
    // Not enough history
    return {
      condition,
      satisfied: false,
    };
  }

  // Evaluate condition for each bar in lookback window
  let trueCount = 0;
  const startIndex = Math.max(0, currentIndex - lookbackBars + 1);

  for (let i = startIndex; i <= currentIndex; i++) {
    const barContext: SignalEvaluationContext = {
      candle: candles[i],
      indicators: indicators[i],
      prevIndicators: i > 0 ? indicators[i - 1] : undefined,
    };

    const result = evaluateCondition(condition, barContext);
    if (result.satisfied) {
      trueCount++;
    }
  }

  const satisfied = trueCount >= minBarsTrue;

  return {
    condition,
    satisfied,
    primaryValue: context.indicators.candle.close,
  };
}

/**
 * Evaluate a single condition
 */
export function evaluateCondition(
  condition: SignalCondition,
  context: SignalEvaluationContext
): ConditionEvaluationResult {
  const { indicator, secondaryIndicator, operator } = condition;
  const field = condition.field ?? 'value';

  // For secondary indicator, use a separate field if specified
  // This allows MACD macd vs MACD signal comparisons
  const secondaryField = condition.secondaryField ?? field;

  const primaryValue = getIndicatorValue(indicator, field, context.indicators);
  const secondaryValue = secondaryIndicator
    ? getIndicatorValue(secondaryIndicator, secondaryField, context.indicators)
    : condition.value;

  const prevPrimaryValue = context.prevIndicators
    ? getIndicatorValue(indicator, field, context.prevIndicators)
    : undefined;
  const prevSecondaryValue =
    context.prevIndicators && secondaryIndicator
      ? getIndicatorValue(secondaryIndicator, secondaryField, context.prevIndicators)
      : undefined;

  const satisfied = compareValues(
    operator,
    primaryValue,
    secondaryValue,
    prevPrimaryValue,
    prevSecondaryValue,
    indicator,
    condition.secondaryIndicator
  );

  return {
    condition,
    satisfied,
    primaryValue,
    secondaryValue,
  };
}

/**
 * Get indicator value from indicators object
 */
function getIndicatorValue(
  indicator: IndicatorName,
  field: string,
  indicators: LegacyIndicatorData
): number | undefined {
  switch (indicator) {
    case 'price_change':
      switch (field) {
        case 'close':
          return indicators.candle.close;
        case 'open':
          return indicators.candle.open;
        case 'high':
          return indicators.candle.high;
        case 'low':
          return indicators.candle.low;
        default:
          return undefined;
      }

    case 'volume_change':
      return indicators.candle.volume;

    case 'sma':
      return indicators.movingAverages.sma20 ?? undefined;

    case 'ema':
      return indicators.movingAverages.ema20 ?? undefined;

    case 'ichimoku_cloud':
      if (!indicators.ichimoku) return undefined;
      switch (field) {
        case 'tenkan':
          return indicators.ichimoku.tenkan;
        case 'kijun':
          return indicators.ichimoku.kijun;
        case 'spanA':
          return indicators.ichimoku.span_a;
        case 'spanB':
          return indicators.ichimoku.span_b;
        case 'chikou':
          return indicators.ichimoku.chikou;
        case 'isBullish':
          return indicators.ichimoku.isBullish ? 1 : 0;
        case 'isBearish':
          return indicators.ichimoku.isBearish ? 1 : 0;
        default:
          return indicators.ichimoku.isBullish ? 1 : indicators.ichimoku.isBearish ? -1 : 0;
      }

    case 'rsi':
      // RSI is not in LegacyIndicatorData yet, but we can add it if needed
      // For now, return undefined - will need to update LegacyIndicatorData
      return undefined;

    case 'macd':
      if (!indicators.macd) return undefined;
      switch (field) {
        case 'macd':
          return indicators.macd.macd;
        case 'signal':
          return indicators.macd.signal;
        case 'histogram':
          return indicators.macd.histogram;
        case 'isBullish':
          return indicators.macd.isBullish ? 1 : 0;
        case 'isBearish':
          return indicators.macd.isBearish ? 1 : 0;
        default:
          return indicators.macd.macd;
      }

    default:
      return undefined;
  }
}

/**
 * Get indicator type for cross detection logic
 */
function getIndicatorType(indicator: IndicatorName): 'trending' | 'oscillating' | 'price' {
  switch (indicator) {
    case 'rsi':
    case 'macd':
      return 'oscillating';
    case 'sma':
    case 'ema':
    case 'ichimoku_cloud':
      return 'trending';
    case 'price_change':
      return 'price';
    default:
      return 'trending';
  }
}

/**
 * Detect cross with type-specific logic
 */
function detectCross(
  operator: 'crosses_above' | 'crosses_below',
  currentPrimary: number,
  currentSecondary: number,
  prevPrimary: number | undefined,
  prevSecondary: number | undefined,
  primaryType?: 'trending' | 'oscillating' | 'price',
  secondaryType?: 'trending' | 'oscillating' | 'price'
): boolean {
  if (prevPrimary === undefined || prevSecondary === undefined) {
    return false;
  }

  // Standard cross detection
  let crossed = false;
  if (operator === 'crosses_above') {
    crossed = prevPrimary <= prevSecondary && currentPrimary > currentSecondary;
  } else {
    crossed = prevPrimary >= prevSecondary && currentPrimary < currentSecondary;
  }

  if (!crossed) {
    return false;
  }

  // For oscillating indicators, add confirmation (stronger signal required)
  if (primaryType === 'oscillating' || secondaryType === 'oscillating') {
    // Require stronger signal for oscillators (minimum difference)
    const minDifference = 0.01; // 1% or 0.01 for normalized values
    return Math.abs(currentPrimary - currentSecondary) > minDifference;
  }

  return true;
}

/**
 * Compare values using the specified operator
 */
function compareValues(
  operator: ComparisonOperator,
  primary: number | undefined,
  secondary: number | undefined,
  prevPrimary?: number,
  prevSecondary?: number,
  primaryIndicator?: IndicatorName,
  secondaryIndicator?: IndicatorName
): boolean {
  if (primary === undefined) return false;

  // Cross conditions need previous values
  if (operator === 'crosses_above' || operator === 'crosses_below') {
    if (prevPrimary === undefined || prevSecondary === undefined || secondary === undefined) {
      return false;
    }

    // Get indicator types for cross detection
    const primaryType = primaryIndicator ? getIndicatorType(primaryIndicator) : undefined;
    const secondaryType = secondaryIndicator ? getIndicatorType(secondaryIndicator) : undefined;

    return detectCross(
      operator,
      primary,
      secondary,
      prevPrimary,
      prevSecondary,
      primaryType,
      secondaryType
    );
  }

  if (secondary === undefined) return false;

  switch (operator) {
    case '>':
      return primary > secondary;
    case '>=':
      return primary >= secondary;
    case '<':
      return primary < secondary;
    case '<=':
      return primary <= secondary;
    case '==':
      return primary === secondary;
    case '!=':
      return primary !== secondary;
    default:
      return false;
  }
}

/**
 * Aggregate child results based on logic (AND/OR)
 */
function aggregateResults(
  logic: 'AND' | 'OR',
  children: Array<ConditionEvaluationResult | GroupEvaluationResult>
): boolean {
  if (children.length === 0) return false;

  if (logic === 'AND') {
    return children.every((child) => child.satisfied);
  }
  return children.some((child) => child.satisfied);
}
