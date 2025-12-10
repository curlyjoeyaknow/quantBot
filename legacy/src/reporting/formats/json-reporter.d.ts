/**
 * JSON Report Generator
 *
 * Generates JSON format reports from analysis results
 */
import { AnalysisResult } from '../../analysis/result-analyzer';
export interface JsonReportOptions {
    path: string;
    pretty?: boolean;
    append?: boolean;
}
export declare class JsonReporter {
    /**
     * Generate JSON report from analysis results
     */
    generate(results: AnalysisResult[], options: JsonReportOptions): Promise<string>;
    private resolvePath;
}
//# sourceMappingURL=json-reporter.d.ts.map