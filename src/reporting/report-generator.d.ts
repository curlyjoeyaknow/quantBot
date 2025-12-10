/**
 * Report Generator
 *
 * Main class for generating reports in various formats
 */
import { AnalysisResult } from '../analysis/result-analyzer';
export type ReportFormat = 'csv' | 'json' | 'html' | 'markdown';
export interface ReportOptions {
    format: ReportFormat;
    output: string;
    [key: string]: unknown;
}
export declare class ReportGenerator {
    private csvReporter;
    private jsonReporter;
    /**
     * Generate a report from analysis results
     */
    generate(results: AnalysisResult[], options: ReportOptions): Promise<string>;
    /**
     * Check if a format is supported
     */
    supports(format: ReportFormat): boolean;
}
//# sourceMappingURL=report-generator.d.ts.map