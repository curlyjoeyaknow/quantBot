/**
 * RunSet Command Definitions
 *
 * Schemas for RunSet management CLI commands.
 * RunSets are logical selections (declarative specs), not data.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Create RunSet schema
 *
 * Creates a new RunSet with declarative selection spec.
 */
export const createRunsetSchema = z.object({
  /** RunSet ID (required, used as deterministic identifier) */
  id: z.string().min(1),

  /** Human-readable name (required) */
  name: z.string().min(1),

  /** Optional description */
  description: z.string().optional(),

  /** Dataset ID (required, e.g., 'ohlcv_v2_2025Q4') */
  dataset: z.string().min(1),

  /** Filter by caller (optional) */
  caller: z.string().optional(),

  /** Filter by chain (optional) */
  chain: z.string().optional(),

  /** Filter by venue (optional) */
  venue: z.string().optional(),

  /** Minimum market cap (USD) */
  minMarketCap: z.number().positive().optional(),

  /** Maximum market cap (USD) */
  maxMarketCap: z.number().positive().optional(),

  /** Minimum volume (USD) */
  minVolume: z.number().positive().optional(),

  /** Start date (ISO 8601, required) */
  from: z.string(),

  /** End date (ISO 8601, required) */
  to: z.string(),

  /** Alert window policy (optional) */
  alertWindowPolicy: z.string().optional(),

  /** Strategy family filter (optional) */
  strategyFamily: z.string().optional(),

  /** Strategy hash filter (optional) */
  strategyHash: z.string().optional(),

  /** Engine version filter (optional) */
  engineVersion: z.string().optional(),

  /** Tags (optional) */
  tags: z.array(z.string()).optional(),

  /** Use latest semantics (exploration mode) */
  latest: z.boolean().default(false),

  /** Auto-resolve after creation */
  autoResolve: z.boolean().default(false),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Resolve RunSet schema
 *
 * Resolves RunSet to concrete run_ids and artifacts.
 */
export const resolveRunsetSchema = z.object({
  /** RunSet ID (required) */
  runsetId: z.string().min(1),

  /** Force re-resolution even if cached/frozen */
  force: z.boolean().default(false),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Freeze RunSet schema
 *
 * Freezes RunSet (pins resolution for reproducibility).
 */
export const freezeRunsetSchema = z.object({
  /** RunSet ID (required) */
  runsetId: z.string().min(1),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * List RunSets schema
 *
 * Lists RunSets with optional filters.
 */
export const listRunsetsSchema = z.object({
  /** Filter by tags */
  tags: z.array(z.string()).optional(),

  /** Filter by dataset ID */
  dataset: z.string().optional(),

  /** Filter by frozen status */
  frozen: z.boolean().optional(),

  /** Filter by mode */
  mode: z.enum(['exploration', 'reproducible']).optional(),

  /** Limit number of results */
  limit: z.number().int().positive().optional(),

  /** Output format */
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Get RunSet schema
 *
 * Gets a specific RunSet by ID.
 */
export const getRunsetSchema = z.object({
  /** RunSet ID (required) */
  runsetId: z.string().min(1),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

