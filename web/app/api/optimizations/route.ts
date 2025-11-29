import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { sanitizePath, sanitizeFilename, PathTraversalError } from '@/lib/security/path-sanitizer';
import { withAuth } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { exists, readdir, readFile } from '@/lib/utils/fs-async';

const EXPORTS_DIR = path.join(process.cwd(), '..', 'data', 'exports');

interface OptimizationResult {
  caller?: string;
  strategy?: string;
  totalReturn?: number;
  winRate?: number;
  totalTrades?: number;
  maxDrawdown?: number;
  file: string;
}

const getOptimizationsHandler = async (request: NextRequest) => {
      if (!(await exists(EXPORTS_DIR))) {
        return NextResponse.json({ data: [] });
      }

      const optimizations: OptimizationResult[] = [];
      const entries = await readdir(EXPORTS_DIR, { withFileTypes: true }) as any[];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.includes('optimization')) {
        // Sanitize directory name
        let safeDirName: string;
        try {
          safeDirName = sanitizeFilename(entry.name);
        } catch (error) {
          // Skip invalid directory names
          continue;
        }

        // Sanitize the full path
        let optPath: string;
        try {
          optPath = sanitizePath(safeDirName, EXPORTS_DIR);
        } catch (error) {
          // Skip invalid paths
          continue;
        }

        const dirFiles = await readdir(optPath) as string[];
        const csvFiles = dirFiles.filter(f => f.endsWith('.csv') && f.includes('optimization'));

        for (const csvFile of csvFiles) {
          // Sanitize CSV filename
          let safeCsvFile: string;
          try {
            safeCsvFile = sanitizeFilename(csvFile);
          } catch (error) {
            // Skip invalid filenames
            continue;
          }

          // Sanitize the full path to CSV file
          let csvPath: string;
          try {
            csvPath = sanitizePath(safeCsvFile, optPath);
          } catch (error) {
            // Skip invalid paths
            continue;
          }

          try {
            const csvContent = await readFile(csvPath, 'utf8');
            const records = parse(csvContent, {
              columns: true,
              skip_empty_lines: true,
            }) as Record<string, any>[];

            // Parse each row as an optimization result
            for (const record of records) {
              // Calculate total return from FinalPortfolio or CompoundFactor if available
              let totalReturn: number | undefined;
              if (record.FinalPortfolio) {
                const final = parseFloat(record.FinalPortfolio);
                totalReturn = ((final / 100) - 1) * 100; // Assuming initial portfolio of 100
              } else if (record.CompoundFactor) {
                const factor = parseFloat(record.CompoundFactor);
                totalReturn = (factor - 1) * 100;
              } else if (record['Total Return (%)']) {
                totalReturn = parseFloat(record['Total Return (%)']);
              } else if (record.totalReturn) {
                totalReturn = parseFloat(record.totalReturn);
              }

              // Parse win rate - try multiple column name variations
              let winRate: number | undefined;
              if (record.WinRate !== undefined && record.WinRate !== '') {
                winRate = parseFloat(record.WinRate);
              } else if (record['Win Rate (%)']) {
                winRate = parseFloat(record['Win Rate (%)']);
              } else if (record.winRate) {
                winRate = parseFloat(record.winRate);
              }

              // Parse total trades
              let totalTrades: number | undefined;
              if (record.TotalTrades !== undefined && record.TotalTrades !== '') {
                totalTrades = parseInt(record.TotalTrades);
              } else if (record['Total Trades']) {
                totalTrades = parseInt(record['Total Trades']);
              } else if (record.totalTrades) {
                totalTrades = parseInt(record.totalTrades);
              } else if (record.Trades) {
                totalTrades = parseInt(record.Trades);
              }

              // Parse max drawdown
              let maxDrawdown: number | undefined;
              if (record.MaxDrawdownPct !== undefined && record.MaxDrawdownPct !== '') {
                maxDrawdown = parseFloat(record.MaxDrawdownPct);
              } else if (record['Max Drawdown (%)']) {
                maxDrawdown = parseFloat(record['Max Drawdown (%)']);
              } else if (record.maxDrawdown) {
                maxDrawdown = parseFloat(record.maxDrawdown);
              } else if (record.MaxDrawdown) {
                // If MaxDrawdown is in dollars, we might need to convert, but for now just use it
                maxDrawdown = parseFloat(record.MaxDrawdown);
              }

              optimizations.push({
                caller: entry.name.replace('-optimization', '').replace('tenkan-kijun-', ''),
                strategy: record.Strategy || record.strategy,
                totalReturn,
                winRate,
                totalTrades,
                maxDrawdown,
                file: csvFile,
              });
            }
          } catch (error) {
            // Ignore parse errors
          }
        }
      }
    }

  return NextResponse.json({ data: optimizations });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getOptimizationsHandler)
);

