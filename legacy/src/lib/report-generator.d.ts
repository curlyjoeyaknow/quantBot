#!/usr/bin/env ts-node
/**
 * Modular Weekly Report Generator
 *
 * Can be called with parameters to generate reports for different strategies,
 * date ranges, and configurations without modifying the script.
 */
import 'dotenv/config';
export interface ReportGeneratorOptions {
    strategyType: 'tenkan-kijun' | 'optimized';
    strategyName?: string;
    simulationTimestamp?: string;
    startDate: string;
    endDate: string;
    callers?: string[];
    outputDir?: string;
    runSimulationsIfMissing?: boolean;
    chain?: 'solana' | 'all';
}
export interface ReportGenerationResult {
    success: boolean;
    reportsGenerated: number;
    outputDirectory: string;
    errors?: string[];
    warnings?: string[];
}
/**
 * Generate weekly reports based on provided options
 */
export declare function generateWeeklyReports(options: ReportGeneratorOptions): Promise<ReportGenerationResult>;
//# sourceMappingURL=report-generator.d.ts.map