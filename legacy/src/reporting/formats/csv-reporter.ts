/**
 * CSV Report Generator
 * 
 * Generates CSV format reports from analysis results
 */

import { promises as fs } from 'fs';
import path from 'path';
import { stringify } from 'csv-stringify';
import { AnalysisResult } from '../../analysis/result-analyzer';

export interface CsvReportOptions {
  path: string;
  append?: boolean;
  includeDetails?: boolean;
}

export class CsvReporter {
  private initializedFiles = new Set<string>();

  /**
   * Generate CSV report from analysis results
   */
  async generate(
    results: AnalysisResult[],
    options: CsvReportOptions
  ): Promise<string> {
    const filePath = this.resolvePath(options.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const isNewFile = !this.initializedFiles.has(filePath) || !options.append;

    if (isNewFile) {
      // Write header
      const header = this.getHeader(options.includeDetails);
      await fs.writeFile(filePath, header, 'utf-8');
      this.initializedFiles.add(filePath);
    }

    // Convert results to CSV rows
    const rows = results.map(result => this.resultToRow(result, options.includeDetails));

    // Write rows
    return new Promise((resolve, reject) => {
      stringify(rows, { header: false }, async (err, output) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          await fs.appendFile(filePath, output, 'utf-8');
          resolve(filePath);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private getHeader(includeDetails?: boolean): string {
    const baseColumns = [
      'Strategy',
      'Total Trades',
      'Win Rate %',
      'Avg PnL %',
      'Total PnL %',
      'Profit Factor',
      'Sharpe Ratio',
      'Max Drawdown %',
    ];

    if (includeDetails) {
      return [
        ...baseColumns,
        'Avg Win',
        'Avg Loss',
        'Largest Win',
        'Largest Loss',
        'Expectancy',
        'Sortino Ratio',
        'Calmar Ratio',
      ].join(',') + '\n';
    }

    return baseColumns.join(',') + '\n';
  }

  private resultToRow(result: AnalysisResult, includeDetails?: boolean): Record<string, string> {
    const base: Record<string, string> = {
      'Strategy': result.summary.totalResults.toString(),
      'Total Trades': result.trade.totalTrades.toString(),
      'Win Rate %': result.trade.winRate.toFixed(2),
      'Avg PnL %': result.pnl.averagePnlPercent.toFixed(2),
      'Total PnL %': result.pnl.totalPnlPercent.toFixed(2),
      'Profit Factor': result.trade.profitFactor.toFixed(2),
      'Sharpe Ratio': result.risk.sharpeRatio.toFixed(2),
      'Max Drawdown %': result.risk.maxDrawdownPercent.toFixed(2),
    };

    if (includeDetails) {
      return {
        ...base,
        'Avg Win': result.trade.avgWin.toFixed(4),
        'Avg Loss': result.trade.avgLoss.toFixed(4),
        'Largest Win': result.trade.largestWin.toFixed(4),
        'Largest Loss': result.trade.largestLoss.toFixed(4),
        'Expectancy': result.trade.expectancy.toFixed(4),
        'Sortino Ratio': result.risk.sortinoRatio.toFixed(2),
        'Calmar Ratio': result.risk.calmarRatio.toFixed(2),
      };
    }

    return base;
  }

  private resolvePath(targetPath: string): string {
    return path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
  }
}

