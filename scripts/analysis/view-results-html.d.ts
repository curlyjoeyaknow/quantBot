/**
 * Generate HTML viewer for scored token results
 */
interface ScoredToken {
    tokenAddress: string;
    tokenSymbol: string;
    chain: string;
    callerName: string;
    callTimestamp: number;
    score: number;
    maxReturn7d: number;
    maxReturn30d: number;
    priceAtCall: number;
    marketCapAtCall: number;
    volumeAtCall: number;
    features?: any;
}
/**
 * Generate HTML viewer
 */
declare function generateHTML(results: ScoredToken[], outputPath: string): void;
export { generateHTML };
//# sourceMappingURL=view-results-html.d.ts.map