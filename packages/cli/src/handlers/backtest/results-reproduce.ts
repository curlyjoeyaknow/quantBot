/**
 * Reproduce Handler
 *
 * Reproduce a previous backtest run by loading metadata and re-executing
 * Pure handler - depends only on ports, no direct I/O (except metadata.json read)
 */

import type { CommandContext } from '../../core/command-context.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface ResultsReproduceArgs {
  runId: string;
  validate?: boolean;
  format?: 'json' | 'table' | 'csv';
}

export async function resultsReproduceHandler(
  args: ResultsReproduceArgs,
  _ctx: CommandContext
): Promise<Record<string, unknown>> {
  const { runId, validate = false } = args;

  // Locate metadata.json (this is the only filesystem operation)
  // In a fully pure implementation, this would also go through a port
  const artifactsBaseDir = join(process.cwd(), 'artifacts', 'backtest');
  const metadataPath = join(artifactsBaseDir, runId, 'metadata.json');

  if (!existsSync(metadataPath)) {
    throw new Error(
      `Backtest metadata not found for run ID: ${runId}\n` +
        `Expected path: ${metadataPath}\n` +
        `Note: Reproduce requires metadata.json file with run configuration.`
    );
  }

  // Load metadata
  const metadataContent = await readFile(metadataPath, 'utf-8');
  const metadata = JSON.parse(metadataContent) as Record<string, unknown>;

  // Extract run parameters from metadata
  const snapshotRef = metadata.snapshotRef as
    | {
        calls: string;
        candles?: string;
      }
    | undefined;

  const strategyConfig = metadata.strategyConfig as Record<string, unknown> | undefined;
  const command = metadata.command as string | undefined;

  if (!snapshotRef || !strategyConfig || !command) {
    throw new Error(
      `Incomplete metadata for run ${runId}. Missing required fields: ` +
        `snapshotRef, strategyConfig, or command`
    );
  }

  // Extract date range from snapshot ref or metadata
  const fromISO = (metadata.fromISO as string) || (snapshotRef.calls as string)?.split('_')[1];
  const toISO = (metadata.toISO as string) || (snapshotRef.calls as string)?.split('_')[2];

  if (!fromISO || !toISO) {
    throw new Error(`Cannot determine date range from metadata for run ${runId}`);
  }

  // Build reproduction command
  const reproductionParams = {
    runId,
    originalCommand: command,
    dateRange: {
      from: fromISO,
      to: toISO,
    },
    interval: (metadata.interval as string) || '5m',
    strategyConfig,
    snapshotRef,
  };

  if (validate) {
    // For validation, we would re-run the backtest and compare results
    // This is a placeholder - full implementation would:
    // 1. Load calls from snapshot
    // 2. Load candles from snapshot
    // 3. Re-execute backtest with same parameters
    // 4. Compare results
    return {
      ...reproductionParams,
      validation: {
        status: 'not_implemented',
        message:
          'Full validation requires re-execution and comparison. ' +
          'This feature is not yet fully implemented.',
      },
    };
  }

  return {
    ...reproductionParams,
    message:
      'Reproduction parameters extracted. ' +
      'To reproduce, use these parameters with the original command.',
    note: 'Full reproduction requires loading calls and candles from snapshot artifacts.',
  };
}
