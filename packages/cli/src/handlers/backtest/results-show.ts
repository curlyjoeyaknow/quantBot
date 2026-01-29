/**
 * Results Show Handler
 *
 * Show detailed results for a backtest run
 * Pure handler - depends only on ports, no direct I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface ResultsShowArgs {
  runId: string;
  format?: 'json' | 'table' | 'csv';
}

export async function resultsShowHandler(
  args: ResultsShowArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const { runId } = args;

  // Get backtest results port from context
  const resultsPort = ctx.services.backtestResults();

  // Check if port is available
  const isAvailable = await resultsPort.isAvailable();
  if (!isAvailable) {
    throw new Error('Backtest results storage is not available');
  }

  // Get run summary from port
  const summary = await resultsPort.getRunSummary(runId);

  if (!summary) {
    // Try to load metadata.json as fallback
    const artifactsBaseDir = join(process.cwd(), 'artifacts', 'backtest');
    const metadataPath = join(artifactsBaseDir, runId, 'metadata.json');

    if (existsSync(metadataPath)) {
      try {
        const metadataContent = await readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataContent) as Record<string, unknown>;
        return {
          runId,
          ...metadata,
          message: 'Run metadata found but no DuckDB results available',
        };
      } catch {
        // Continue to error
      }
    }

    throw new Error(
      `Backtest results not found for run ID: ${runId}\n` +
        `Expected paths:\n` +
        `  - ${join(process.cwd(), 'artifacts', 'backtest', runId, 'results.duckdb')}\n` +
        `  - ${join(process.cwd(), 'artifacts', 'backtest', runId, 'metadata.json')}`
    );
  }

  // Format result with metrics
  const result: Record<string, unknown> = {
    runId: summary.runId,
    metrics: {
      totalTrades: summary.totalTrades,
      totalPnlUsd: summary.totalPnlUsd.toFixed(2),
      totalPnlPct: (summary.totalPnlPct * 100).toFixed(2) + '%',
      avgReturnBps: summary.avgReturnBps.toFixed(1),
      winRate: (summary.winRate * 100).toFixed(1) + '%',
      maxDrawdownBps: summary.maxDrawdownBps.toFixed(0),
      medianDrawdownBps: summary.medianDrawdownBps
        ? summary.medianDrawdownBps.toFixed(0)
        : null,
      totalCalls: summary.totalCalls,
      uniqueCallers: summary.uniqueCallers,
      createdAt: summary.createdAt,
    },
  };

  // Try to load metadata.json for additional context
  const artifactsBaseDir = join(process.cwd(), 'artifacts', 'backtest');
  const metadataPath = join(artifactsBaseDir, runId, 'metadata.json');
  if (existsSync(metadataPath)) {
    try {
      const metadataContent = await readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent) as Record<string, unknown>;
      // Merge metadata (excluding metrics which we already have)
      Object.keys(metadata).forEach((key) => {
        if (key !== 'metrics' && key !== 'runId') {
          result[key] = metadata[key];
        }
      });
    } catch {
      // Ignore metadata read errors
    }
  }

  return result;
}
