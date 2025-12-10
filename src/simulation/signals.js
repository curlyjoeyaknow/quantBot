"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSignalGroup = evaluateSignalGroup;
exports.evaluateSignalCondition = evaluateSignalCondition;
exports.evaluateLadderLegs = evaluateLadderLegs;
function evaluateSignalGroup(group, context) {
    const children = [];
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
function evaluateSignalCondition(condition, context) {
    const { indicator, secondaryIndicator, operator } = condition;
    const field = condition.field ?? 'value';
    const primaryValue = getIndicatorField(indicator, field, context.indicators);
    const secondaryValue = secondaryIndicator != null
        ? getIndicatorField(secondaryIndicator, field, context.indicators)
        : condition.value;
    const prevPrimaryValue = context.prevIndicators != null
        ? getIndicatorField(indicator, field, context.prevIndicators)
        : undefined;
    const prevSecondaryValue = context.prevIndicators != null && secondaryIndicator != null
        ? getIndicatorField(secondaryIndicator, field, context.prevIndicators)
        : undefined;
    const satisfied = compareValues(operator, primaryValue, secondaryValue, prevPrimaryValue, prevSecondaryValue);
    return {
        condition,
        satisfied,
    };
}
function aggregateChildren(logic, children) {
    if (children.length === 0) {
        return false;
    }
    if (logic === 'AND') {
        return children.every((child) => child.satisfied);
    }
    return children.some((child) => child.satisfied);
}
function getIndicatorField(indicator, field, indicators) {
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
function compareValues(operator, primary, secondary, prevPrimary, prevSecondary) {
    if (primary === undefined) {
        return false;
    }
    if (operator === 'crosses_above' || operator === 'crosses_below') {
        if (prevPrimary === undefined ||
            prevSecondary === undefined ||
            secondary === undefined) {
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
function evaluateLadderLegs(ladder, context, alreadyFilledLegIds) {
    const executable = [];
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
//# sourceMappingURL=signals.js.map