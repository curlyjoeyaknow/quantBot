/**
 * JSON Report Generator
 * 
 * Generates JSON format reports from analysis results
 */

import { promises as fs } from 'fs';
import path from 'path';
import { AnalysisResult } from '../../analysis/result-analyzer';

export interface JsonReportOptions {
  path: string;
  pretty?: boolean;
  append?: boolean;
}

export class JsonReporter {
  /**
   * Generate JSON report from analysis results
   */
  async generate(
    results: AnalysisResult[],
    options: JsonReportOptions
  ): Promise<string> {
    const filePath = this.resolvePath(options.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const data = {
      timestamp: new Date().toISOString(),
      results,
      summary: {
        totalStrategies: results.length,
        bestPerformance: results.length > 0 
          ? results.sort((a, b) => b.pnl.averagePnlPercent - a.pnl.averagePnlPercent)[0]
          : null,
      },
    };

    const json = JSON.stringify(data, null, options.pretty ? 2 : undefined);

    if (options.append) {
      // For append mode, read existing array and add to it
      try {
        const existing = await fs.readFile(filePath, 'utf-8');
        const existingData = JSON.parse(existing);
        if (Array.isArray(existingData)) {
          existingData.push(data);
          await fs.writeFile(filePath, JSON.stringify(existingData, null, options.pretty ? 2 : undefined), 'utf-8');
          return filePath;
        }
      } catch {
        // File doesn't exist or invalid, create new
      }
    }

    await fs.writeFile(filePath, json, 'utf-8');
    return filePath;
  }

  private resolvePath(targetPath: string): string {
    return path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
  }
}

