/**
 * Artifact Schema
 *
 * Defines the directory structure and file formats for run artifacts.
 */

/**
 * Run Artifact Directory Structure
 *
 * artifacts/
 *   {run_id}/
 *     manifest.json          - Run manifest (required)
 *     events.ndjson          - Simulation events (one per line, NDJSON)
 *     metrics.json           - Aggregated metrics
 *     positions.ndjson       - Position snapshots (one per line, NDJSON)
 *     debug.log              - Optional debug logs
 */
export const ARTIFACT_DIR_STRUCTURE = {
  manifest: 'manifest.json',
  events: 'events.ndjson',
  metrics: 'metrics.json',
  positions: 'positions.ndjson',
  debug: 'debug.log',
} as const;

export type ArtifactFileType = keyof typeof ARTIFACT_DIR_STRUCTURE;
