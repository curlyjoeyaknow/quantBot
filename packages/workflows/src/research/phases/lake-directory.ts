/**
 * Data Lake Directory Management
 *
 * Utilities for creating and managing data lake directory structure:
 * data/lake/runs/run_id={workflowRunId}/
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { WorkflowRunMetadata } from './types.js';
import { logger } from '@quantbot/utils';

/**
 * Create data lake directory structure for a workflow run
 */
export async function createLakeRunDirectory(
  dataRoot: string,
  workflowRunId: string
): Promise<string> {
  const lakeRoot = join(dataRoot, 'lake');
  const runsDir = join(lakeRoot, 'runs');
  const runDir = join(runsDir, `run_id=${workflowRunId}`);

  // Create directory structure
  await mkdir(join(runDir, 'inputs'), { recursive: true });
  await mkdir(join(runDir, 'phase1'), { recursive: true });
  await mkdir(join(runDir, 'phase2'), { recursive: true });
  await mkdir(join(runDir, 'phase3'), { recursive: true });
  await mkdir(join(runDir, 'outputs'), { recursive: true });

  logger.info('Created lake run directory', { workflowRunId, runDir });

  return runDir;
}

/**
 * Write manifest.json for workflow run
 */
export async function writeWorkflowManifest(
  runDir: string,
  metadata: WorkflowRunMetadata
): Promise<void> {
  const manifestPath = join(runDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(metadata, null, 2), 'utf-8');
  logger.debug('Wrote workflow manifest', { manifestPath });
}

/**
 * Write phase configuration to inputs directory
 */
export async function writePhaseConfig(
  runDir: string,
  phase: 'phase1' | 'phase2' | 'phase3',
  config: unknown
): Promise<void> {
  const configPath = join(runDir, 'inputs', `${phase}-config.json`);
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  logger.debug('Wrote phase config', { phase, configPath });
}

/**
 * Get path for phase artifact
 */
export function getPhaseArtifactPath(
  runDir: string,
  phase: 'phase1' | 'phase2' | 'phase3',
  artifactName: string
): string {
  return join(runDir, phase, artifactName);
}

/**
 * Get path for output artifact
 */
export function getOutputArtifactPath(runDir: string, artifactName: string): string {
  return join(runDir, 'outputs', artifactName);
}

/**
 * Check if workflow run directory exists
 */
export function workflowRunExists(dataRoot: string, workflowRunId: string): boolean {
  const runDir = join(dataRoot, 'lake', 'runs', `run_id=${workflowRunId}`);
  return existsSync(runDir);
}

/**
 * Load workflow manifest if it exists
 */
export async function loadWorkflowManifest(
  runDir: string
): Promise<WorkflowRunMetadata | null> {
  const manifestPath = join(runDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  const { readFile } = await import('fs/promises');
  const content = await readFile(manifestPath, 'utf-8');
  return JSON.parse(content) as WorkflowRunMetadata;
}

