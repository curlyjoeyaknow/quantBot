/**
 * Registry Command Definitions
 *
 * Schemas for registry management CLI commands.
 * Registry is the Parquet-first metadata store with DuckDB as cache.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Registry rebuild schema
 *
 * Rebuilds DuckDB registry from Parquet truth.
 */
export const registryRebuildSchema = z.object({
  /** Force rebuild even if DuckDB exists */
  force: z.boolean().default(false),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

