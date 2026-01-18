/**
 * Migrate existing JSON/CSV results to central DuckDB
 */

import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { upsertRunMetadata } from '@quantbot/backtest';
import { logger } from '@quantbot/infra/utils';

type BacktestRunMode =
  | 'path-only'
  | 'exit-optimizer'
  | 'exit-stack'
  | 'policy'
  | 'optimize'
  | 'baseline';
const allowedRunModes = new Set<BacktestRunMode>([
  'path-only',
  'exit-optimizer',
  'exit-stack',
  'policy',
  'optimize',
  'baseline',
]);
const coerceRunMode = (raw: unknown): BacktestRunMode => {
  const s = typeof raw === 'string' ? raw : '';
  return allowedRunModes.has(s as BacktestRunMode) ? (s as BacktestRunMode) : 'baseline';
};

export interface MigrateResultsArgs {
  resultsDir?: string;
  dryRun?: boolean;
}

/**
 * Extract run ID from filename
 */
function extractRunId(filename: string): string | null {
  // Try to extract run ID from various filename patterns
  // e.g., "986615550b45_random_search.json" -> "986615550b45"
  // e.g., "55dc495fb6de49a99180c96e83b43b5a_results.json" -> "55dc495fb6de49a99180c96e83b43b5a"
  const match = filename.match(/^([a-f0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * Determine run mode from filename or content
 */
function determineRunMode(filename: string, _content?: unknown): BacktestRunMode {
  if (filename.includes('random_search')) return 'optimize';
  if (filename.includes('optimizer')) return 'optimize';
  if (filename.includes('baseline')) return 'baseline';
  if (filename.includes('walk_forward')) return 'optimize';
  return 'exit-optimizer';
}

/**
 * Parse JSON result file and extract metadata
 */
async function parseResultFile(filePath: string): Promise<{
  runId: string;
  metadata: {
    run_id: string;
    run_mode: BacktestRunMode;
    status: 'completed' | 'failed';
    params_json: string;
    total_calls?: number;
    total_trades?: number;
    total_pnl_usd?: number;
    avg_return_bps?: number;
  };
} | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const filename = filePath.split('/').pop() || '';
    const runId = data.run_id || extractRunId(filename);
    if (!runId) {
      logger.warn('Could not extract run ID from file', { filePath });
      return null;
    }

    const runMode = determineRunMode(filename, data);
    const config = data.config || {};
    const results = data.results || [];
    const summary = data.summary || {};

    // Extract metrics from results/summary
    const totalCalls = summary.alerts_total || summary.alerts_ok || results.length || undefined;
    const totalTrades =
      summary.trades_total ||
      results.filter((r: { trades?: unknown }) => r.trades).length ||
      undefined;
    const totalPnlUsd = summary.total_pnl_usd || summary.pnl_quote || undefined;
    const avgReturnBps =
      summary.avg_return_bps || summary.median_return_bps
        ? (summary.avg_return_bps || summary.median_return_bps) * 100
        : undefined;

    // Determine status
    let status: 'completed' | 'failed' = 'completed';
    if (data.error || data.status === 'failed') {
      status = 'failed';
    }

    // Build params_json
    const paramsJson = JSON.stringify({
      config,
      filename,
      source: 'migrated',
    });

    return {
      runId,
      metadata: {
        run_id: runId,
        run_mode: coerceRunMode(runMode),
        status,
        params_json: paramsJson,
        total_calls: totalCalls,
        total_trades: totalTrades,
        total_pnl_usd: totalPnlUsd,
        avg_return_bps: avgReturnBps,
      },
    };
  } catch (error) {
    logger.warn('Failed to parse result file', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Scan results directory for JSON/CSV files
 */
async function scanResultsDirectory(resultsDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(resultsDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(resultsDir, entry.name);
    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const subFiles = await scanResultsDirectory(fullPath);
      files.push(...subFiles);
    } else if (
      entry.isFile() &&
      (extname(entry.name) === '.json' || extname(entry.name) === '.csv')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Migrate results handler
 */
export async function migrateResultsHandler(
  args: MigrateResultsArgs,
  _ctx: unknown
): Promise<{ migrated: number; failed: number; skipped: number }> {
  const resultsDir = args.resultsDir || join(process.cwd(), 'results');
  const dryRun = args.dryRun ?? false;

  logger.info('Starting results migration', {
    resultsDir,
    dryRun,
  });

  // Ensure schema exists
  // Scan for result files
  const files = await scanResultsDirectory(resultsDir);
  logger.info('Found result files', { count: files.length });

  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  // Process each file
  for (const filePath of files) {
    try {
      const parsed = await parseResultFile(filePath);
      if (!parsed) {
        skipped++;
        continue;
      }

      if (dryRun) {
        logger.info('Would migrate run', {
          runId: parsed.runId,
          filePath,
          metadata: parsed.metadata,
        });
        migrated++;
      } else {
        await upsertRunMetadata(parsed.metadata);
        logger.info('Migrated run', {
          runId: parsed.runId,
          filePath,
        });
        migrated++;
      }
    } catch (error) {
      logger.error('Failed to migrate file', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  logger.info('Migration complete', {
    migrated,
    failed,
    skipped,
    total: files.length,
  });

  return {
    migrated,
    failed,
    skipped,
  };
}
