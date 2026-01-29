/**
 * Research Artifacts Command Definitions
 *
 * Schemas for artifact store CLI commands (research package).
 * These commands use ArtifactStorePort (Parquet + SQLite manifest).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * List artifacts schema
 *
 * Lists artifacts from artifact store with optional filters.
 */
export const listResearchArtifactsSchema = z.object({
  /** Filter by artifact type (e.g., 'alerts_v1', 'ohlcv_slice_v2') */
  type: z.string().optional(),

  /** Filter by status */
  status: z.enum(['active', 'superseded', 'tombstoned']).optional(),

  /** Limit number of results */
  limit: z.number().int().positive().optional(),

  /** Output format */
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Get artifact schema
 *
 * Gets a specific artifact by ID.
 */
export const getResearchArtifactSchema = z.object({
  /** Artifact ID (UUID) */
  artifactId: z.string().uuid(),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Find artifact schema
 *
 * Finds artifacts by logical key.
 */
export const findResearchArtifactSchema = z.object({
  /** Artifact type (required) */
  type: z.string().min(1),

  /** Logical key (required) */
  logicalKey: z.string().min(1),

  /** Output format */
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Get artifact lineage schema
 *
 * Gets lineage (input artifacts) for a specific artifact.
 */
export const getResearchArtifactLineageSchema = z.object({
  /** Artifact ID (UUID) */
  artifactId: z.string().uuid(),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Get downstream artifacts schema
 *
 * Gets downstream artifacts (outputs that depend on this artifact).
 */
export const getResearchArtifactDownstreamSchema = z.object({
  /** Artifact ID (UUID) */
  artifactId: z.string().uuid(),

  /** Output format */
  format: z.enum(['json', 'table', 'csv']).default('table'),
});
