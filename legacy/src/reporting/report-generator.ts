/**
 * Report Generator
 * 
 * Main class for generating reports in various formats
 */

import { AnalysisResult } from '../analysis/result-analyzer';
import { CsvReporter, CsvReportOptions } from './formats/csv-reporter';
import { JsonReporter, JsonReportOptions } from './formats/json-reporter';

export type ReportFormat = 'csv' | 'json' | 'html' | 'markdown';

export interface ReportOptions {
  format: ReportFormat;
  output: string;
  [key: string]: unknown;
}

export class ReportGenerator {
  private csvReporter = new CsvReporter();
  private jsonReporter = new JsonReporter();

  /**
   * Generate a report from analysis results
   */
  async generate(
    results: AnalysisResult[],
    options: ReportOptions
  ): Promise<string> {
    switch (options.format) {
      case 'csv':
        return this.csvReporter.generate(
          results,
          options as CsvReportOptions
        );

      case 'json':
        return this.jsonReporter.generate(
          results,
          options as JsonReportOptions
        );

      case 'html':
        throw new Error('HTML reporter not yet implemented');

      case 'markdown':
        throw new Error('Markdown reporter not yet implemented');

      default:
        throw new Error(`Unsupported report format: ${options.format}`);
    }
  }

  /**
   * Check if a format is supported
   */
  supports(format: ReportFormat): boolean {
    return ['csv', 'json'].includes(format);
  }
}

