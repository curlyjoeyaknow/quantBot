/**
 * Results Writer - Standard results writing pattern
 *
 * Provides a consistent interface for writing sweep/workflow results:
 * - Pre-create all output files (prevents ENOENT errors)
 * - Write JSONL incrementally (per_call.jsonl, per_caller.jsonl, errors.jsonl)
 * - Maintain in-memory accumulators for matrix summaries
 * - Write run.meta.json with git sha, config hash, timings
 * - Write config.json for provenance
 *
 * This pattern makes output handling robust and consistent across all workflows.
 */

import { writeFileSync } from 'fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DateTime } from 'luxon';
import { ConfigurationError } from '@quantbot/infra/utils';
import type { RunMetadata } from './run-meta.js';
import { getGitSha, generateConfigHash, generateSweepId } from './run-meta.js';

/**
 * Artifact paths for a run
 */
export interface ArtifactPaths {
  outDir: string;
  perCall: string;
  perCaller: string;
  matrix: string;
  errors: string;
  meta: string;
  config: string;
}

/**
 * Result counts
 */
export interface ResultCounts {
  perCallRows: number;
  perCallerRows: number;
  errors: number;
}

/**
 * Safe error serialization
 */
function safeError(e: unknown): { name: string; message: string; stack?: string } {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { name: 'UnknownError', message: String(e) };
}

/**
 * Results Writer - handles all output file operations
 *
 * Usage:
 * ```typescript
 * const writer = new ResultsWriter();
 * await writer.initialize(outDir, config);
 * await writer.writePerCall(row);
 * await writer.writePerCaller(row);
 * await writer.writeError(error);
 * await writer.writeMatrix(matrix);
 * const result = await writer.finalize();
 * ```
 */
export class ResultsWriter {
  private paths?: ArtifactPaths;
  private counts: ResultCounts = {
    perCallRows: 0,
    perCallerRows: 0,
    errors: 0,
  };
  private startedAt?: DateTime;
  private sweepId?: string;
  private gitSha?: string;
  private configHash?: string;
  private config?: Record<string, unknown>;
  private completedScenarioIds: string[] = [];

  /**
   * Initialize results writer
   *
   * Creates output directory and pre-creates all output files.
   * Writes initial metadata to run.meta.json and config to config.json.
   *
   * @param outDir - Output directory path
   * @param config - Run configuration (for provenance)
   */
  async initialize(outDir: string, config: Record<string, unknown>): Promise<void> {
    // Create output directory
    await fs.mkdir(outDir, { recursive: true });

    // Generate metadata
    this.sweepId = generateSweepId();
    this.gitSha = getGitSha();
    this.configHash = generateConfigHash(config);
    this.config = config;
    this.startedAt = DateTime.utc();

    // Define artifact paths
    this.paths = {
      outDir,
      perCall: path.join(outDir, 'per_call.jsonl'),
      perCaller: path.join(outDir, 'per_caller.jsonl'),
      matrix: path.join(outDir, 'matrix.json'),
      errors: path.join(outDir, 'errors.jsonl'),
      meta: path.join(outDir, 'run.meta.json'),
      config: path.join(outDir, 'config.json'),
    };

    // Pre-create all JSONL files (empty)
    await fs.writeFile(this.paths.perCall, '', 'utf8');
    await fs.writeFile(this.paths.perCaller, '', 'utf8');
    await fs.writeFile(this.paths.errors, '', 'utf8');

    // Write config.json (provenance)
    writeFileSync(this.paths.config, JSON.stringify(this.config, null, 2), 'utf-8');

    // Write initial run.meta.json (with placeholder values)
    const initialMeta: RunMetadata = {
      sweepId: this.sweepId,
      startedAtISO: this.startedAt.toISO()!,
      completedAtISO: '', // Will be updated at finalize
      durationMs: 0, // Will be updated at finalize
      gitSha: this.gitSha,
      configHash: this.configHash,
      config: this.config,
      counts: {
        totalRuns: 0,
        totalResults: 0,
        totalCallerSummaries: 0,
      },
      diagnostics: {},
      completedScenarioIds: [],
    };
    writeFileSync(this.paths.meta, JSON.stringify(initialMeta, null, 2), 'utf-8');
  }

  /**
   * Write per-call row to per_call.jsonl
   */
  async writePerCall(row: unknown): Promise<void> {
    if (!this.paths) {
      throw new ConfigurationError(
        'ResultsWriter not initialized. Call initialize() first.',
        'ResultsWriter.paths',
        { operation: 'writePerCall' }
      );
    }
    const line = JSON.stringify(row) + '\n';
    await fs.appendFile(this.paths.perCall, line, 'utf8');
    this.counts.perCallRows++;
  }

  /**
   * Write per-caller row to per_caller.jsonl
   */
  async writePerCaller(row: unknown): Promise<void> {
    if (!this.paths) {
      throw new ConfigurationError(
        'ResultsWriter not initialized. Call initialize() first.',
        'ResultsWriter.paths',
        { operation: 'writePerCaller' }
      );
    }
    const line = JSON.stringify(row) + '\n';
    await fs.appendFile(this.paths.perCaller, line, 'utf8');
    this.counts.perCallerRows++;
  }

  /**
   * Write error to errors.jsonl
   */
  async writeError(error: unknown): Promise<void> {
    if (!this.paths) {
      throw new ConfigurationError(
        'ResultsWriter not initialized. Call initialize() first.',
        'ResultsWriter.paths',
        { operation: 'writeError' }
      );
    }
    const errorRow = {
      kind: 'error',
      error: safeError(error),
      ts: DateTime.utc().toISO(),
    };
    const line = JSON.stringify(errorRow) + '\n';
    await fs.appendFile(this.paths.errors, line, 'utf8');
    this.counts.errors++;
  }

  /**
   * Write matrix aggregation to matrix.json
   */
  async writeMatrix(matrix: Record<string, unknown>): Promise<void> {
    if (!this.paths) {
      throw new ConfigurationError(
        'ResultsWriter not initialized. Call initialize() first.',
        'ResultsWriter.paths',
        { operation: 'writeMatrix' }
      );
    }
    writeFileSync(this.paths.matrix, JSON.stringify(matrix, null, 2), 'utf-8');
  }

  /**
   * Add completed scenario ID (for resume support)
   */
  addCompletedScenario(scenarioId: string): void {
    this.completedScenarioIds.push(scenarioId);
  }

  /**
   * Finalize results and write final run.meta.json
   *
   * Updates run.meta.json with final counts, timings, and completed scenario IDs.
   *
   * @param additionalMeta - Additional metadata to include (diagnostics, etc.)
   * @returns Artifact paths and counts
   */
  async finalize(additionalMeta?: {
    counts?: { totalRuns?: number };
    diagnostics?: Record<string, unknown>;
  }): Promise<{ paths: ArtifactPaths; counts: ResultCounts }> {
    if (
      !this.paths ||
      !this.startedAt ||
      !this.sweepId ||
      !this.gitSha ||
      !this.configHash ||
      !this.config
    ) {
      throw new ConfigurationError(
        'ResultsWriter not initialized. Call initialize() first.',
        'ResultsWriter',
        { operation: 'finalize' }
      );
    }

    const completedAt = DateTime.utc();
    const durationMs = completedAt.diff(this.startedAt).as('milliseconds');

    const finalMeta: RunMetadata = {
      sweepId: this.sweepId,
      startedAtISO: this.startedAt.toISO()!,
      completedAtISO: completedAt.toISO()!,
      durationMs,
      gitSha: this.gitSha,
      configHash: this.configHash,
      config: this.config,
      counts: {
        totalRuns: additionalMeta?.counts?.totalRuns ?? 0,
        totalResults: this.counts.perCallRows,
        totalCallerSummaries: this.counts.perCallerRows,
      },
      diagnostics: additionalMeta?.diagnostics ?? {},
      completedScenarioIds: this.completedScenarioIds,
    };

    writeFileSync(this.paths.meta, JSON.stringify(finalMeta, null, 2), 'utf-8');

    return {
      paths: this.paths,
      counts: this.counts,
    };
  }

  /**
   * Get current artifact paths (if initialized)
   */
  getPaths(): ArtifactPaths | undefined {
    return this.paths;
  }

  /**
   * Get current counts
   */
  getCounts(): ResultCounts {
    return { ...this.counts };
  }
}
