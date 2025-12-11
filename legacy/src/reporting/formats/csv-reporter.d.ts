/**
 * CSV Report Generator
 *
 * Generates CSV format reports from analysis results
 */
import { AnalysisResult } from '../../analysis/result-analyzer';
export interface CsvReportOptions {
    path: string;
    append?: boolean;
    includeDetails?: boolean;
}
export declare class CsvReporter {
    private initializedFiles;
    /**
     * Generate CSV report from analysis results
     */
    generate(results: AnalysisResult[], options: CsvReportOptions): Promise<string>;
    private getHeader;
    private resultToRow;
    private resolvePath;
}
//# sourceMappingURL=csv-reporter.d.ts.map