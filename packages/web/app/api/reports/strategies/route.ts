import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

const PROJECT_ROOT = path.join(process.cwd(), '../..');
const OPTIMIZED_DIR = path.join(PROJECT_ROOT, 'data/exports/solana-callers-optimized');

const getStrategiesHandler = async (request: NextRequest) => {
      const strategies: Array<{
        name: string;
        displayName: string;
        timestamp: string;
        category: string;
      }> = [];

      // Add Tenkan-Kijun strategy
      strategies.push({
        name: 'Tenkan-Kijun Weighted Portfolio',
        displayName: 'Tenkan-Kijun (Weighted Portfolio)',
        timestamp: '',
        category: 'Original',
      });

      // Scan for optimized strategies
      if (fs.existsSync(OPTIMIZED_DIR)) {
        const timestamps = fs.readdirSync(OPTIMIZED_DIR, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name)
          .filter(name => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name))
          .sort()
          .reverse(); // Most recent first

        for (const timestamp of timestamps) {
          const timestampDir = path.join(OPTIMIZED_DIR, timestamp);
          
          // Look for strategy summary files or trade files
          const files = fs.readdirSync(timestampDir, { recursive: true });
          const strategyFiles = files
            .filter((f): f is string => typeof f === 'string')
            .filter(f => 
              f.includes('_trades.csv') || 
              f.includes('strategy_aggregation.csv')
            );

          // Extract unique strategy names from file names
          const strategyNames = new Set<string>();
          for (const file of strategyFiles) {
            const match = file.match(/([^/]+)_trades\.csv$/);
            if (match) {
              strategyNames.add(match[1]);
            }
          }

          for (const strategyName of strategyNames) {
            strategies.push({
              name: strategyName,
              displayName: strategyName.replace(/_/g, ' '),
              timestamp,
              category: 'Optimized',
            });
          }
        }
      }

  return NextResponse.json({
    strategies,
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getStrategiesHandler)
);

