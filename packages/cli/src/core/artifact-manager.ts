/**
 * Artifact Manager - Organize outputs by run ID
 *
 * Creates directory structure for each run and provides utilities
 * to write artifacts (results, events, metrics, logs).
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { RunIdComponents } from './run-id-manager.js';
import { generateRunId } from './run-id-manager.js';

/**
 * Artifact paths for a run
 */
export interface ArtifactPaths {
  /** Base directory for artifacts */
  baseDir: string;
  /** Run-specific directory */
  runDir: string;
  /** Path to simulation results JSON */
  resultsJson: string;
  /** Path to simulation events CSV */
  eventsCsv: string;
  /** Path to metrics JSON */
  metricsJson: string;
  /** Path to logs */
  logsTxt: string;
}

/**
 * Create artifact directory structure for a run
 *
 * @param components - Run ID components
 * @param baseDir - Base directory for artifacts (default: './artifacts')
 * @returns Artifact paths
 */
export async function createArtifactDirectory(
  components: RunIdComponents,
  baseDir: string = './artifacts'
): Promise<ArtifactPaths> {
  const runId = generateRunId(components);
  const runDir = join(baseDir, runId);

  await mkdir(runDir, { recursive: true });

  return {
    baseDir,
    runDir,
    resultsJson: join(runDir, 'results.json'),
    eventsCsv: join(runDir, 'events.csv'),
    metricsJson: join(runDir, 'metrics.json'),
    logsTxt: join(runDir, 'logs.txt'),
  };
}

/**
 * Write artifact to disk
 *
 * @param paths - Artifact paths
 * @param artifactName - Name of artifact to write
 * @param data - Data to write (will be JSON stringified if not string)
 */
export async function writeArtifact(
  paths: ArtifactPaths,
  artifactName: keyof Omit<ArtifactPaths, 'baseDir' | 'runDir'>,
  data: unknown
): Promise<void> {
  const path = paths[artifactName];
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  await writeFile(path, content, 'utf8');
}

/**
 * Write CSV artifact (for events)
 *
 * @param paths - Artifact paths
 * @param rows - Array of row objects
 * @param headers - Optional headers (auto-detected from first row if not provided)
 */
export async function writeCsvArtifact(
  paths: ArtifactPaths,
  rows: Array<Record<string, unknown>>,
  headers?: string[]
): Promise<void> {
  if (rows.length === 0) {
    await writeFile(paths.eventsCsv, '', 'utf8');
    return;
  }

  // Auto-detect headers from first row if not provided
  const csvHeaders = headers || Object.keys(rows[0] as Record<string, unknown>);

  // Escape CSV values
  const escapeCsv = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV content
  const lines: string[] = [];
  lines.push(csvHeaders.map(escapeCsv).join(','));

  for (const row of rows) {
    const values = csvHeaders.map((header) => escapeCsv(row[header]));
    lines.push(values.join(','));
  }

  await writeFile(paths.eventsCsv, lines.join('\n'), 'utf8');
}
