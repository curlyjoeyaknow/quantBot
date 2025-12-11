/**
 * Score all tokens in unified calls table and analyze P&L for high-scoring tokens
 */
import { type TokenFeatures } from './analyze-brook-token-selection';
interface UnifiedCall {
    id: number;
    tokenAddress: string;
    tokenSymbol?: string;
    chain: string;
    callTimestamp: number;
    priceAtCall?: number;
    volumeAtCall?: number;
    marketCapAtCall?: number;
    callerName: string;
}
interface ScoredCall extends UnifiedCall {
    score: number;
    features: TokenFeatures;
    maxReturn7d: number;
    maxReturn30d: number;
    returnAt7d: number;
    returnAt30d: number;
    performanceCategory: 'moon' | 'good' | 'decent' | 'poor';
}
/**
 * Score and analyze all calls
 */
declare function scoreAndAnalyzeCalls(calls: UnifiedCall[], scoreModel: (features: TokenFeatures) => number): Promise<ScoredCall[]>;
/**
 * Analyze P&L by score ranges
 */
declare function analyzePnLByScore(scoredCalls: ScoredCall[]): void;
export { scoreAndAnalyzeCalls, analyzePnLByScore };
//# sourceMappingURL=score-and-analyze-unified-calls.d.ts.map