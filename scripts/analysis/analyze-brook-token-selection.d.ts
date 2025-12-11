/**
 * Analyze Brook's token selection patterns to identify common denominators
 * in high-performing picks and build a predictive model
 */
interface TokenFeatures {
    price: number;
    volume: number;
    marketCap: number;
    priceChange1h: number;
    priceChange24h: number;
    priceChange15m: number;
    volumeChange1h: number;
    avgVolume24h: number;
    hourOfDay: number;
    dayOfWeek: number;
    isWeekend: boolean;
    tokenAgeHours?: number;
    volatility24h: number;
    marketCapCategory: 'micro' | 'small' | 'mid' | 'large';
}
interface CallAnalysis extends TokenFeatures {
    tokenAddress: string;
    tokenSymbol?: string;
    callTimestamp: Date;
    maxReturn7d: number;
    maxReturn30d: number;
    returnAt7d: number;
    returnAt30d: number;
    performanceCategory: 'moon' | 'good' | 'decent' | 'poor';
}
/**
 * Analyze all Brook calls
 */
export declare function analyzeBrookCalls(): Promise<CallAnalysis[]>;
/**
 * Identify patterns in high performers
 */
export declare function identifyPatterns(analyses: CallAnalysis[]): void;
/**
 * Build scoring model based on patterns
 */
export declare function buildScoringModel(analyses: CallAnalysis[]): (features: TokenFeatures) => number;
export type { CallAnalysis, TokenFeatures };
//# sourceMappingURL=analyze-brook-token-selection.d.ts.map