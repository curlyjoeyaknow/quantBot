import type { Candle } from './candles';
import type { IndicatorData } from './indicators';
import {
  ComparisonOperator,
  IndicatorName,
  LadderConfig,
  LadderLeg,
  SignalCondition,
  SignalGroup,
} from './config';

export interface SignalEvaluationContext {
  candle: Candle;
  indicators: IndicatorData;
  /**
   * Previous indicator snapshot (for cross conditions).
   */
  prevIndicators?: IndicatorData | null;
  /**
   * Position-level state (size, average entry, ladders filled, etc.).
   * This is intentionally untyped at this level so the engine can evolve it
   * without forcing a refactor of the signal layer.
   */
  positionState?: Record<string, unknown>;
}

export interface ConditionEvaluationResult {
  condition: SignalCondition;
  satisfied: boolean;
}

export interface GroupEvaluationResult {
  group: SignalGroup;
  satisfied: boolean;
  children: Array<ConditionEvaluationResult | GroupEvaluationResult>;
}

export function evaluateSignalGroup(
  group: SignalGroup,
  context: SignalEvaluationContext,
): GroupEvaluationResult {
  const children: Array<ConditionEvaluationResult | GroupEvaluationResult> = [];

  for (const condition of group.conditions ?? []) {
    const conditionResult = evaluateSignalCondition(condition, context);
    children.push(conditionResult);
  }

  for (const childGroup of group.groups ?? []) {
    const groupResult = evaluateSignalGroup(childGroup, context);
    children.push(groupResult);
  }

  const satisfied = aggregateChildren(group.logic, children);

  return {
    group,
    satisfied,
    children,
  };
}

export function evaluateSignalCondition(
  condition: SignalCondition,
  context: SignalEvaluationContext,
): ConditionEvaluationResult {
  const { indicator, secondaryIndicator, operator } = condition;
  const field = condition.field ?? 'value';

  const primaryValue = getIndicatorField(indicator, field, context.indicators);
  const secondaryValue =
    secondaryIndicator != null
      ? getIndicatorField(secondaryIndicator, field, context.indicators)
      : condition.value;

  const prevPrimaryValue =
    context.prevIndicators != null
      ? getIndicatorField(indicator, field, context.prevIndicators)
      : undefined;
  const prevSecondaryValue =
    context.prevIndicators != null && secondaryIndicator != null
      ? getIndicatorField(secondaryIndicator, field, context.prevIndicators)
      : undefined;

  const satisfied = compareValues(
    operator,
    primaryValue,
    secondaryValue,
    prevPrimaryValue,
    prevSecondaryValue,
  );

  return {
    condition,
    satisfied,
  };
}

function aggregateChildren(
  logic: SignalGroup['logic'],
  children: Array<ConditionEvaluationResult | GroupEvaluationResult>,
): boolean {
  if (children.length === 0) {
    return false;
  }

  if (logic === 'AND') {
    return children.every((child) => child.satisfied);
  }

  return children.some((child) => child.satisfied);
}

function getIndicatorField(
  indicator: IndicatorName,
  field: string,
  indicators: IndicatorData,
): number | undefined {
  switch (indicator) {
    case 'price_change':
      if (field === 'close') {
        return indicators.candle.close;
      }
      if (field === 'open') {
        return indicators.candle.open;
      }
      if (field === 'high') {
        return indicators.candle.high;
      }
      if (field === 'low') {
        return indicators.candle.low;
      }
      return undefined;
    case 'volume_change':
      return indicators.candle.volume;
    case 'sma':
      // default to 20-period SMA unless caller uses a more specific indicator
      return indicators.movingAverages.sma20 ?? undefined;
    case 'ema':
      return indicators.movingAverages.ema20 ?? undefined;
    case 'ichimoku_cloud':
      if (!indicators.ichimoku) {
        return undefined;
      }
      switch (field) {
        case 'tenkan':
          return indicators.ichimoku.tenkan;
        case 'kijun':
          return field === 'kijun'
            ? indicators.ichimoku.kijun
            : field === 'spanA'
              ? indicators.ichimoku.span_a
              : field === 'spanB'
                ? indicators.ichimoku.span_b
                : indicators.ichimoku.isBullish
                  ? 1
                  : indicators.ichimoku.isBearish
                    ? -1
                    : 0;
      }
    default:
      // Additional indicators (RSI, MACD, etc.) can be wired here once added to IndicatorData.
      return undefined;
  }
}

function compareValues(
  operator: ComparisonOperator,
  primary: number | undefined,
  secondary: number | undefined,
  prevPrimary?: number,
  prevSecondary?: number,
): boolean {
  if (primary === undefined) {
    return false;
  }

  if (operator === 'crosses_above' || operator === 'crosses_below') {
    if (
      prevPrimary === undefined ||
      prevSecondary === undefined ||
      secondary === undefined
    ) {
      return false;
    }

    if (operator === 'crosses_above') {
      return prevPrimary <= prevSecondary && primary > secondary;
    }

    return prevPrimary >= prevSecondary && primary < secondary;
  }

  if (secondary === undefined) {
    return false;
  }

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

export function evaluateLadderLegs(
  ladder: LadderConfig,
  context: SignalEvaluationContext,
  alreadyFilledLegIds: Set<string>,
): LadderLeg[] {
  const executable: LadderLeg[] = [];

  for (const leg of ladder.legs) {
    const legId = leg.id ?? `${leg.sizePercent}:${leg.priceOffset ?? 0}:${leg.multiple ?? 0}`;
    if (alreadyFilledLegIds.has(legId)) {
      continue;
    }

    if (!leg.signal) {
      executable.push(leg);
      if (ladder.sequential) {
        break;
      }
      continue;
    }

    const result = evaluateSignalGroup(leg.signal, context);
    if (result.satisfied) {
      executable.push(leg);
      if (ladder.sequential) {
        break;
      }
    }
  }

  return executable;
}


