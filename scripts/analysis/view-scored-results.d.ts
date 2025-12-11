/**
 * Viewer for scored token results
 * Displays results in a readable format with filtering and sorting
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
 * Load the most recent scored results file
 */
export declare function getLatestResultsFile(): string | null;
/**
 * Load results from JSON file
 */
declare function loadResults(filePath: string): ScoredToken[];
/**
 * Display results in table format
 */
declare function displayTable(results: ScoredToken[], limit?: number): void;
/**
 * Display statistics
 */
declare function displayStats(results: ScoredToken[]): void;
/**
 * Filter results by criteria
 */
declare function filterResults(results: ScoredToken[], options: {
    minScore?: number;
    maxScore?: number;
    minReturn7d?: number;
    minReturn30d?: number;
    chain?: string;
    caller?: string;
}): ScoredToken[];
export { loadResults, displayTable, displayStats, filterResults };
//# sourceMappingURL=view-scored-results.d.ts.map