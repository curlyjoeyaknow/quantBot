/**
 * Score new tokens using Brook's selection patterns
 * This script can be used to identify tokens that match Brook's criteria
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
    volatility24h: number;
    marketCapCategory: 'micro' | 'small' | 'mid' | 'large';
}
interface TokenScore {
    tokenAddress: string;
    tokenSymbol?: string;
    score: number;
    features: TokenFeatures;
    reasons: string[];
}
/**
 * Extract features from a token at current time
 */
declare function extractTokenFeatures(tokenAddress: string, chain?: string): Promise<TokenFeatures | null>;
/**
 * Score multiple tokens
 */
export declare function scoreTokens(tokenAddresses: string[], chain?: string, forceRebuild?: boolean): Promise<TokenScore[]>;
export { scoreTokens, extractTokenFeatures };
//# sourceMappingURL=score-tokens-like-brook.d.ts.map