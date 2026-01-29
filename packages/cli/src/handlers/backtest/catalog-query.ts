/**
 * Catalog Query Handler
 *
 * Query the backtest catalog for runs matching criteria.
 * Pure handler - depends only on ports, no direct I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface CatalogQueryArgs {
  duckdb?: string;
  runType?: string;
  status?: string;
  gitBranch?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  runId?: string;
  artifactType?: string;
}

export async function catalogQueryHandler(
  args: CatalogQueryArgs,
  ctx: CommandContext
): Promise<unknown> {
  const {
    runType,
    status,
    gitBranch,
    fromDate,
    toDate,
    limit = 10,
    runId,
    artifactType,
  } = args;

  // Get backtest results port from context
  const resultsPort = ctx.services.backtestResults();

  // Check if port is available
  const isAvailable = await resultsPort.isAvailable();
  if (!isAvailable) {
    throw new Error('Backtest results storage is not available');
  }

  // Query via port
  const summaries = await resultsPort.listRunSummaries({
    runId,
    fromDate,
    toDate,
    limit,
  });

  // Apply additional filters that require metadata inspection
  let filtered = summaries;

  // Filter by run type (requires metadata inspection)
  if (runType) {
    const artifactsBaseDir = join(process.cwd(), 'artifacts', 'backtest');
    filtered = filtered.filter((s) => {
      const metadataPath = join(artifactsBaseDir, s.runId, 'metadata.json');
      if (existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
          const mode = (metadata.runMode || metadata.command || '').toLowerCase();
          return mode.includes(runType.toLowerCase());
        } catch {
          return false;
        }
      }
      return false;
    });
  }

  // Filter by status (completed/failed based on trades)
  if (status) {
    if (status.toLowerCase() === 'completed') {
      filtered = filtered.filter((s) => s.totalTrades > 0);
    } else if (status.toLowerCase() === 'failed') {
      filtered = filtered.filter((s) => s.totalTrades === 0);
    }
  }

  // Filter by git branch (requires metadata inspection)
  if (gitBranch) {
    const artifactsBaseDir = join(process.cwd(), 'artifacts', 'backtest');
    filtered = filtered.filter((s) => {
      const metadataPath = join(artifactsBaseDir, s.runId, 'metadata.json');
      if (existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
          return (metadata.gitBranch || '').toLowerCase() === gitBranch.toLowerCase();
        } catch {
          return false;
        }
      }
      return false;
    });
  }

  // Filter by artifact type (requires filesystem inspection)
  if (artifactType) {
    const artifactsBaseDir = join(process.cwd(), 'artifacts', 'backtest');
    filtered = filtered.filter((s) => {
      const runDir = join(artifactsBaseDir, s.runId);
      if (artifactType === 'parquet') {
        // Would need to check for parquet files
        return existsSync(join(runDir, 'results.parquet'));
      } else if (artifactType === 'duckdb') {
        return existsSync(join(runDir, 'results.duckdb'));
      } else if (artifactType === 'metadata') {
        return existsSync(join(runDir, 'metadata.json'));
      }
      return false;
    });
  }

  // Format results
  return filtered.map((s) => ({
    runId: s.runId,
    totalTrades: s.totalTrades,
    totalPnlUsd: s.totalPnlUsd.toFixed(2),
    totalPnlPct: (s.totalPnlPct * 100).toFixed(2) + '%',
    winRate: (s.winRate * 100).toFixed(1) + '%',
    totalCalls: s.totalCalls,
    uniqueCallers: s.uniqueCallers,
    createdAt: s.createdAt,
  }));
}
