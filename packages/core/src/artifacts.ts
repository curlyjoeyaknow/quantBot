/**
 * Artifact Versioning System
 *
 * Artifacts are first-class, versioned entities:
 * - Strategies
 * - Feature sets
 * - Simulation runs
 * - Parameter sweeps
 * - Data snapshots
 * - Execution configs
 * - Cost models
 *
 * Artifacts are not code side-effects. They're lab specimens.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';

/**
 * Artifact type
 */
export type ArtifactType =
  | 'strategy'
  | 'feature_set'
  | 'simulation_run'
  | 'parameter_sweep'
  | 'data_snapshot'
  | 'execution_config'
  | 'cost_model';

/**
 * Artifact metadata schema
 */
export const ArtifactMetadataSchema = z.object({
  /**
   * Unique artifact ID
   */
  id: z.string(),

  /**
   * Artifact type
   */
  type: z.enum([
    'strategy',
    'feature_set',
    'simulation_run',
    'parameter_sweep',
    'data_snapshot',
    'execution_config',
    'cost_model',
  ]),

  /**
   * Artifact version (semver or custom)
   */
  version: z.string(),

  /**
   * Content hash (SHA256) for deduplication
   */
  hash: z.string(),

  /**
   * Creation timestamp (ISO 8601)
   */
  createdAt: z.string(),

  /**
   * Optional tags for categorization
   */
  tags: z.array(z.string()).optional(),

  /**
   * Optional description
   */
  description: z.string().optional(),

  /**
   * Optional parent artifact ID (for versioning)
   */
  parentId: z.string().optional(),

  /**
   * Git commit hash (if applicable)
   */
  gitCommitHash: z.string().optional(),
});

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

/**
 * Artifact schema
 *
 * Generic artifact container with type-specific content
 */
export const ArtifactSchema = z.object({
  metadata: ArtifactMetadataSchema,
  content: z.record(z.string(), z.unknown()),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

/**
 * Strategy artifact schema
 */
export const StrategyArtifactSchema = ArtifactSchema.extend({
  metadata: ArtifactMetadataSchema.extend({
    type: z.literal('strategy'),
  }),
  content: z.object({
    name: z.string(),
    config: z.record(z.string(), z.unknown()),
    strategyVersion: z.string().optional(),
  }),
});

export type StrategyArtifact = z.infer<typeof StrategyArtifactSchema>;

/**
 * Simulation run artifact schema
 */
export const SimulationRunArtifactSchema = ArtifactSchema.extend({
  metadata: ArtifactMetadataSchema.extend({
    type: z.literal('simulation_run'),
  }),
  content: z.object({
    runId: z.string(),
    strategyId: z.string(),
    dataSnapshotHash: z.string(),
    parameterVectorHash: z.string(),
    randomSeed: z.number().int(),
    result: z.record(z.string(), z.unknown()),
  }),
});

export type SimulationRunArtifact = z.infer<typeof SimulationRunArtifactSchema>;

/**
 * Data snapshot artifact schema
 */
export const DataSnapshotArtifactSchema = ArtifactSchema.extend({
  metadata: ArtifactMetadataSchema.extend({
    type: z.literal('data_snapshot'),
  }),
  content: z.object({
    mint: z.string().optional(),
    timeRange: z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .optional(),
    dataHash: z.string(),
    canonicalDataHash: z.string().optional(),
  }),
});

export type DataSnapshotArtifact = z.infer<typeof DataSnapshotArtifactSchema>;

/**
 * Generate artifact hash from content
 *
 * Creates SHA256 hash of JSON-serialized content for deduplication
 */
import { createHash } from 'crypto';

export function generateArtifactHash(content: Record<string, unknown>): string {
  const json = JSON.stringify(content, Object.keys(content).sort());
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Create artifact metadata
 */
export function createArtifactMetadata(
  id: string,
  type: ArtifactType,
  version: string,
  content: Record<string, unknown>,
  options?: {
    tags?: string[];
    description?: string;
    parentId?: string;
    gitCommitHash?: string;
  }
): ArtifactMetadata {
  const hash = generateArtifactHash(content);

  return {
    id,
    type,
    version,
    hash,
    createdAt: DateTime.utc().toISO()!,
    tags: options?.tags,
    description: options?.description,
    parentId: options?.parentId,
    gitCommitHash: options?.gitCommitHash,
  };
}
