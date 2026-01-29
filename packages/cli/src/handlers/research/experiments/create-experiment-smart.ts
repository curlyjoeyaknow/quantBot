/**
 * Smart Experiment Creation Handler (Research Package)
 *
 * Creates experiments with high-level filters and automatic artifact selection.
 * Supports exploratory workflows where users specify intent (caller, dates, strategy)
 * and the system selects the most relevant artifacts.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../../core/command-context.js';
import type { createSmartExperimentSchema } from '../../../command-defs/research-experiments.js';
import type { Experiment, ExperimentDefinition, ArtifactManifestRecord } from '@quantbot/core';
import { execSync } from 'child_process';

export type CreateSmartExperimentArgs = z.infer<typeof createSmartExperimentSchema>;

/**
 * Artifact selection result
 */
export interface ArtifactSelection {
  /** Selected alert artifacts */
  alerts: ArtifactManifestRecord[];
  /** Selected OHLCV artifacts */
  ohlcv: ArtifactManifestRecord[];
  /** Selection rationale */
  rationale: {
    alerts: string;
    ohlcv: string;
  };
}

/**
 * Result from smart experiment creation
 */
export interface CreateSmartExperimentResult {
  /** Created experiment */
  experiment: Experiment;
  /** Selected artifacts */
  selection: ArtifactSelection;
  /** Whether user confirmation was requested */
  confirmed: boolean;
  /** Success message */
  message: string;
}

/**
 * Get git commit hash and dirty status
 */
function getGitProvenance(): { gitCommit: string; gitDirty: boolean } {
  try {
    const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    const gitDirty = gitStatus.length > 0;
    return { gitCommit, gitDirty };
  } catch (error) {
    return { gitCommit: 'unknown', gitDirty: false };
  }
}

/**
 * Select alert artifacts based on filters
 */
async function selectAlertArtifacts(
  args: CreateSmartExperimentArgs,
  ctx: CommandContext
): Promise<{ artifacts: ArtifactManifestRecord[]; rationale: string }> {
  const artifactStore = ctx.services.artifactStore();

  // Build logical key filter based on date range and caller
  // Format: day=YYYY-MM-DD/chain=solana[/caller=<caller>]
  const fromDate = new Date(args.from);
  const toDate = new Date(args.to);

  const artifacts: ArtifactManifestRecord[] = [];
  const rationale: string[] = [];

  // If specific caller provided, find artifacts for that caller
  if (args.caller) {
    // Try to find caller-specific artifacts
    const callerKey = `caller=${args.caller}`;
    const callerArtifacts = await artifactStore.listArtifacts({
      artifactType: 'alerts_v1',
      status: 'active',
      limit: 1000,
    });

    // Filter by date range and caller in logical key
    const filtered = callerArtifacts.filter((a) => {
      const hasCallerInKey = a.logicalKey.includes(callerKey);
      if (!hasCallerInKey) return false;

      // Check date range
      if (a.minTs && a.maxTs) {
        const artifactStart = new Date(a.minTs);
        const artifactEnd = new Date(a.maxTs);
        return artifactStart <= toDate && artifactEnd >= fromDate;
      }
      return true;
    });

    artifacts.push(...filtered);
    rationale.push(
      `Selected ${filtered.length} alert artifacts for caller "${args.caller}" within date range ${args.from} to ${args.to}`
    );
  } else {
    // No caller specified - find all alerts in date range
    const allArtifacts = await artifactStore.listArtifacts({
      artifactType: 'alerts_v1',
      status: 'active',
      limit: 1000,
    });

    // Filter by date range
    const filtered = allArtifacts.filter((a) => {
      if (a.minTs && a.maxTs) {
        const artifactStart = new Date(a.minTs);
        const artifactEnd = new Date(a.maxTs);
        return artifactStart <= toDate && artifactEnd >= fromDate;
      }
      // If no timestamps, include by default (day-partitioned artifacts)
      const dayMatch = a.logicalKey.match(/day=(\d{4}-\d{2}-\d{2})/);
      if (dayMatch) {
        const artifactDate = new Date(dayMatch[1]);
        return artifactDate >= fromDate && artifactDate <= toDate;
      }
      return false;
    });

    artifacts.push(...filtered);
    rationale.push(
      `Selected ${filtered.length} alert artifacts within date range ${args.from} to ${args.to} (all callers)`
    );
  }

  return {
    artifacts,
    rationale: rationale.join('; '),
  };
}

/**
 * Select OHLCV artifacts based on alert artifacts
 */
async function selectOhlcvArtifacts(
  alertArtifacts: ArtifactManifestRecord[],
  args: CreateSmartExperimentArgs,
  ctx: CommandContext
): Promise<{ artifacts: ArtifactManifestRecord[]; rationale: string }> {
  const artifactStore = ctx.services.artifactStore();

  // Strategy:
  // 1. Extract unique mints from alert artifacts (would need to read Parquet)
  // 2. Find OHLCV slices that cover those mints + date range
  // 3. For now, use a simpler heuristic: find OHLCV slices that overlap date range

  const fromDate = new Date(args.from);
  const toDate = new Date(args.to);

  const allOhlcv = await artifactStore.listArtifacts({
    artifactType: 'ohlcv_slice_v2',
    status: 'active',
    limit: 1000,
  });

  // Filter by date range overlap
  const filtered = allOhlcv.filter((a) => {
    if (a.minTs && a.maxTs) {
      const artifactStart = new Date(a.minTs);
      const artifactEnd = new Date(a.maxTs);
      // Check for overlap: artifact overlaps if it starts before range ends AND ends after range starts
      return artifactStart <= toDate && artifactEnd >= fromDate;
    }
    return false;
  });

  const rationale = `Selected ${filtered.length} OHLCV slice artifacts that overlap date range ${args.from} to ${args.to}`;

  return {
    artifacts: filtered,
    rationale,
  };
}

/**
 * Create experiment with smart artifact selection
 *
 * Pure handler - depends only on ports.
 * Automatically selects relevant artifacts based on high-level filters.
 *
 * Workflow:
 * 1. Select alert artifacts (by caller + date range)
 * 2. Select OHLCV artifacts (by date range)
 * 3. If --confirm flag, prompt user for confirmation
 * 4. Create experiment with selected artifacts
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Created experiment with selection details
 *
 * @example
 * ```typescript
 * // Create experiment for specific caller
 * const result = await createSmartExperimentHandler(
 *   {
 *     name: 'momentum-test',
 *     caller: 'whale_watcher',
 *     from: '2025-05-01',
 *     to: '2025-05-31',
 *     strategy: { name: 'momentum', threshold: 0.05 },
 *   },
 *   ctx
 * );
 *
 * // Create experiment for all callers
 * const result = await createSmartExperimentHandler(
 *   {
 *     name: 'momentum-all-callers',
 *     from: '2025-05-01',
 *     to: '2025-05-31',
 *     strategy: { name: 'momentum', threshold: 0.05 },
 *   },
 *   ctx
 * );
 * ```
 */
export async function createSmartExperimentHandler(
  args: CreateSmartExperimentArgs,
  ctx: CommandContext
): Promise<CreateSmartExperimentResult> {
  // Get services from context (lazy initialization)
  const experimentTracker = ctx.services.experimentTracker();

  // 1. Select alert artifacts
  const alertSelection = await selectAlertArtifacts(args, ctx);

  if (alertSelection.artifacts.length === 0) {
    throw new Error(
      `No alert artifacts found for ${args.caller ? `caller "${args.caller}"` : 'any caller'} in date range ${args.from} to ${args.to}`
    );
  }

  // 2. Select OHLCV artifacts
  const ohlcvSelection = await selectOhlcvArtifacts(alertSelection.artifacts, args, ctx);

  if (ohlcvSelection.artifacts.length === 0) {
    throw new Error(`No OHLCV artifacts found for date range ${args.from} to ${args.to}`);
  }

  // 3. Build artifact selection summary
  const selection: ArtifactSelection = {
    alerts: alertSelection.artifacts,
    ohlcv: ohlcvSelection.artifacts,
    rationale: {
      alerts: alertSelection.rationale,
      ohlcv: ohlcvSelection.rationale,
    },
  };

  // 4. If confirmation required, return selection for user review
  // (In CLI, executor will handle confirmation prompt)
  if (args.confirm && !args.autoConfirm) {
    // Return selection without creating experiment
    // CLI executor will prompt user and call again with --auto-confirm
    return {
      experiment: null as any, // Will be created after confirmation
      selection,
      confirmed: false,
      message: 'Artifact selection ready for confirmation',
    };
  }

  // 5. Generate experiment ID
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const experimentId = `exp-${timestamp}-${randomSuffix}`;

  // 6. Get git provenance
  const { gitCommit, gitDirty } = getGitProvenance();

  // 7. Build experiment definition
  const definition: ExperimentDefinition = {
    experimentId,
    name: args.name,
    description: args.description || `Smart experiment: ${args.caller || 'all callers'}, ${args.from} to ${args.to}`,
    inputs: {
      alerts: selection.alerts.map((a) => a.artifactId),
      ohlcv: selection.ohlcv.map((a) => a.artifactId),
      strategies: args.strategies,
    },
    config: {
      strategy: args.strategy || {},
      dateRange: {
        from: args.from,
        to: args.to,
      },
      params: {
        ...args.params,
        // Add selection metadata
        _selection: {
          caller: args.caller,
          alertCount: selection.alerts.length,
          ohlcvCount: selection.ohlcv.length,
          rationale: selection.rationale,
        },
      },
    },
    provenance: {
      gitCommit,
      gitDirty,
      engineVersion: '1.0.0',
      createdAt: new Date().toISOString(),
    },
  };

  // 8. Create experiment
  const experiment = await experimentTracker.createExperiment(definition);

  return {
    experiment,
    selection,
    confirmed: true,
    message: `Experiment created: ${experimentId} (${selection.alerts.length} alert artifacts, ${selection.ohlcv.length} OHLCV artifacts)`,
  };
}

