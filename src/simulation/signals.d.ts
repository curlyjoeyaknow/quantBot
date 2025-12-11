import type { Candle } from './candles';
import type { IndicatorData } from './indicators';
import { LadderConfig, LadderLeg, SignalCondition, SignalGroup } from './config';
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
export declare function evaluateSignalGroup(group: SignalGroup, context: SignalEvaluationContext): GroupEvaluationResult;
export declare function evaluateSignalCondition(condition: SignalCondition, context: SignalEvaluationContext): ConditionEvaluationResult;
export declare function evaluateLadderLegs(ladder: LadderConfig, context: SignalEvaluationContext, alreadyFilledLegIds: Set<string>): LadderLeg[];
//# sourceMappingURL=signals.d.ts.map