/**
 * Research Experiments Command Definitions
 *
 * Schemas for experiment tracking CLI commands (research package).
 * These commands use ExperimentTrackerPort (DuckDB with artifact lineage).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Create experiment schema
 *
 * Creates a new experiment with frozen artifact sets.
 */
export const createResearchExperimentSchema = z.object({
  /** Experiment name (required) */
  name: z.string().min(1),

  /** Optional description */
  description: z.string().optional(),

  /** Alert artifact IDs (comma-separated) */
  alerts: z.array(z.string().uuid()),

  /** OHLCV artifact IDs (comma-separated) */
  ohlcv: z.array(z.string().uuid()),

  /** Strategy artifact IDs (optional, comma-separated) */
  strategies: z.array(z.string().uuid()).optional(),

  /** Strategy configuration (JSON) */
  strategy: z.record(z.unknown()).optional(),

  /** Start date (ISO 8601) */
  from: z.string(),

  /** End date (ISO 8601) */
  to: z.string(),

  /** Additional parameters (JSON) */
  params: z.record(z.unknown()).optional(),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Execute experiment schema
 *
 * Executes an experiment with frozen artifact sets.
 */
export const executeResearchExperimentSchema = z.object({
  /** Experiment ID (required) */
  experimentId: z.string().min(1),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Get experiment schema
 *
 * Gets a specific experiment by ID.
 */
export const getResearchExperimentSchema = z.object({
  /** Experiment ID (required) */
  experimentId: z.string().min(1),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * List experiments schema
 *
 * Lists experiments with optional filters.
 */
export const listResearchExperimentsSchema = z.object({
  /** Filter by status */
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),

  /** Filter by git commit */
  gitCommit: z.string().optional(),

  /** Filter by minimum creation date (ISO 8601) */
  minCreatedAt: z.string().optional(),

  /** Filter by maximum creation date (ISO 8601) */
  maxCreatedAt: z.string().optional(),

  /** Limit number of results */
  limit: z.number().int().positive().optional(),

  /** Output format */
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Find experiments by inputs schema
 *
 * Finds experiments by input artifact IDs.
 */
export const findResearchExperimentsByInputsSchema = z.object({
  /** Artifact IDs to search for (comma-separated) */
  artifacts: z.array(z.string().uuid()),

  /** Output format */
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Create smart experiment schema
 *
 * Creates experiment with automatic artifact selection based on high-level filters.
 * Supports exploratory workflows where users specify intent (caller, dates, strategy)
 * and the system selects the most relevant artifacts.
 */
export const createSmartExperimentSchema = z.object({
  /** Experiment name (required) */
  name: z.string().min(1),

  /** Optional description */
  description: z.string().optional(),

  /** Filter by caller (optional - if omitted, uses all callers) */
  caller: z.string().optional(),

  /** Start date (ISO 8601, required) */
  from: z.string(),

  /** End date (ISO 8601, required) */
  to: z.string(),

  /** Strategy artifact IDs (optional, comma-separated) */
  strategies: z.array(z.string().uuid()).optional(),

  /** Strategy configuration (JSON) */
  strategy: z.record(z.unknown()).optional(),

  /** Additional parameters (JSON) */
  params: z.record(z.unknown()).optional(),

  /** Confirm artifact selection before creating experiment (default: true) */
  confirm: z.boolean().default(true),

  /** Auto-confirm artifact selection (skip confirmation prompt) */
  autoConfirm: z.boolean().default(false),

  /** Output format */
  format: z.enum(['json', 'table']).default('table'),
});
