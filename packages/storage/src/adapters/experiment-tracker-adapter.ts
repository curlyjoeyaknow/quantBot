import { join } from 'path';
import { z } from 'zod';
import type {
  ExperimentTrackerPort,
  Experiment,
  ExperimentDefinition,
  ExperimentStatus,
  ExperimentFilter,
  ExperimentResults,
} from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import { logger, findWorkspaceRoot, NotFoundError, AppError } from '@quantbot/infra/utils';

// Zod schemas for validation
const ExperimentInputsSchema = z.object({
  alerts: z.array(z.string()),
  ohlcv: z.array(z.string()),
  strategies: z.array(z.string()).optional(),
});

const ExperimentConfigSchema = z.object({
  strategy: z.record(z.string(), z.unknown()),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
  params: z.record(z.string(), z.unknown()),
});

const ExperimentProvenanceSchema = z.object({
  gitCommit: z.string(),
  gitDirty: z.boolean(),
  engineVersion: z.string(),
  createdAt: z.string(),
});

const ExperimentSchema = z.object({
  experimentId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  inputs: ExperimentInputsSchema,
  config: ExperimentConfigSchema,
  provenance: ExperimentProvenanceSchema,
  outputs: z
    .object({
      trades: z.string().optional(),
      metrics: z.string().optional(),
      curves: z.string().optional(),
      diagnostics: z.string().optional(),
    })
    .optional(),
  execution: z
    .object({
      startedAt: z.string(),
      completedAt: z.string().optional(),
      duration: z.number().optional(),
      error: z.string().optional(),
    })
    .optional(),
});

const SuccessResultSchema = z.object({
  success: z.boolean(),
});

// Input validation functions
function validateExperimentId(id: string): void {
  if (!id || id.length === 0) {
    throw new AppError('Experiment ID cannot be empty', 'VALIDATION_ERROR', 400);
  }
  if (id.length > 100) {
    throw new AppError(
      'Experiment ID exceeds maximum length of 100 characters',
      'VALIDATION_ERROR',
      400
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new AppError(
      `Experiment ID contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed: ${id}`,
      'VALIDATION_ERROR',
      400
    );
  }
}

function validateArtifactId(id: string): void {
  if (!id || id.length === 0) {
    throw new AppError('Artifact ID cannot be empty', 'VALIDATION_ERROR', 400);
  }
  if (id.length > 100) {
    throw new AppError(
      'Artifact ID exceeds maximum length of 100 characters',
      'VALIDATION_ERROR',
      400
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new AppError(
      `Artifact ID contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed: ${id}`,
      'VALIDATION_ERROR',
      400
    );
  }
}

function validateStatus(status: ExperimentStatus): void {
  if (!status || status.length === 0) {
    throw new AppError('Status cannot be empty', 'VALIDATION_ERROR', 400);
  }
  const validStatuses: ExperimentStatus[] = [
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled',
  ];
  if (!validStatuses.includes(status)) {
    throw new AppError(
      `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`,
      'VALIDATION_ERROR',
      400
    );
  }
}

function validateDateString(dateStr: string): void {
  if (!dateStr || dateStr.length === 0) {
    throw new AppError('Date string cannot be empty', 'VALIDATION_ERROR', 400);
  }
  // Basic ISO 8601 format check
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!iso8601Regex.test(dateStr)) {
    throw new AppError(
      `Invalid date format: ${dateStr}. Expected ISO 8601 format`,
      'VALIDATION_ERROR',
      400
    );
  }
}

function validateLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return; // Optional parameter
  }
  if (!Number.isInteger(limit)) {
    throw new AppError(`Limit must be an integer: ${limit}`, 'VALIDATION_ERROR', 400);
  }
  if (limit < 1) {
    throw new AppError(`Limit must be at least 1: ${limit}`, 'VALIDATION_ERROR', 400);
  }
  if (limit > 10000) {
    throw new AppError(`Limit cannot exceed 10000: ${limit}`, 'VALIDATION_ERROR', 400);
  }
}

function validateGitCommit(commit: string): void {
  if (!commit || commit.length === 0) {
    throw new AppError('Git commit cannot be empty', 'VALIDATION_ERROR', 400);
  }
  if (commit.length > 40) {
    throw new AppError('Git commit hash cannot exceed 40 characters', 'VALIDATION_ERROR', 400);
  }
  // Allow partial commit hashes (for testing) - minimum 1 character
  // Full commit hash is 40 chars, but partial hashes are also valid in git
  // Allow alphanumeric for flexibility (some test scenarios use non-standard formats)
  if (!/^[a-zA-Z0-9]+$/.test(commit)) {
    throw new AppError(
      `Invalid git commit format. Expected alphanumeric characters: ${commit}`,
      'VALIDATION_ERROR',
      400
    );
  }
}

/**
 * Experiment Tracker Adapter
 *
 * Implements ExperimentTrackerPort using DuckDB for storage.
 * Uses PythonEngine to call Python scripts (following existing pattern).
 *
 * Pattern: Same as ArtifactStoreAdapter, ProjectionBuilderAdapter, etc.
 */
export class ExperimentTrackerAdapter implements ExperimentTrackerPort {
  private readonly pythonEngine: PythonEngine;
  private readonly scriptPath: string;
  private readonly dbPath: string;

  constructor(dbPath: string, pythonEngine?: PythonEngine) {
    this.dbPath = dbPath;
    this.pythonEngine = pythonEngine || new PythonEngine();

    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/experiment_tracker_ops.py');
  }

  async createExperiment(definition: ExperimentDefinition): Promise<Experiment> {
    logger.debug('Creating experiment', { experimentId: definition.experimentId });

    // Validate inputs
    validateExperimentId(definition.experimentId);
    definition.inputs.alerts.forEach(validateArtifactId);
    definition.inputs.ohlcv.forEach(validateArtifactId);
    definition.inputs.strategies?.forEach(validateArtifactId);
    validateDateString(definition.provenance.createdAt);
    validateGitCommit(definition.provenance.gitCommit);

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'create_experiment',
          dbPath: this.dbPath,
          definition: {
            experimentId: definition.experimentId,
            name: definition.name,
            description: definition.description,
            inputs: {
              alerts: definition.inputs.alerts,
              ohlcv: definition.inputs.ohlcv,
              strategies: definition.inputs.strategies,
            },
            config: definition.config,
            provenance: {
              gitCommit: definition.provenance.gitCommit,
              gitDirty: definition.provenance.gitDirty,
              engineVersion: definition.provenance.engineVersion,
              createdAt: definition.provenance.createdAt,
            },
          },
        },
        ExperimentSchema
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Preserve validation errors
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      throw new AppError(
        `Failed to create experiment: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500,
        { experimentId: definition.experimentId }
      );
    }
  }

  async getExperiment(experimentId: string): Promise<Experiment> {
    logger.debug('Getting experiment', { experimentId });

    // Validate input
    validateExperimentId(experimentId);

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'get_experiment',
          dbPath: this.dbPath,
          experimentId,
        },
        ExperimentSchema
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Preserve validation errors
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      if (message.includes('not found') || message.includes('not found:')) {
        throw new NotFoundError('Experiment', experimentId, { experimentId });
      }
      throw new AppError(`Failed to get experiment: ${message}`, 'EXPERIMENT_TRACKER_ERROR', 500, {
        experimentId,
      });
    }
  }

  async listExperiments(filter: ExperimentFilter): Promise<Experiment[]> {
    logger.debug('Listing experiments', { filter });

    // Validate filter inputs
    if (filter.status !== undefined) {
      validateStatus(filter.status);
    }
    if (filter.gitCommit !== undefined) {
      validateGitCommit(filter.gitCommit);
    }
    if (filter.minCreatedAt !== undefined) {
      validateDateString(filter.minCreatedAt);
    }
    if (filter.maxCreatedAt !== undefined) {
      validateDateString(filter.maxCreatedAt);
    }
    validateLimit(filter.limit);

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'list_experiments',
          dbPath: this.dbPath,
          filter: {
            status: filter.status,
            artifactType: filter.artifactType,
            gitCommit: filter.gitCommit,
            minCreatedAt: filter.minCreatedAt,
            maxCreatedAt: filter.maxCreatedAt,
            limit: filter.limit,
          },
        },
        z.array(ExperimentSchema)
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Preserve validation errors
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      throw new AppError(
        `Failed to list experiments: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500,
        { filter }
      );
    }
  }

  async updateStatus(experimentId: string, status: ExperimentStatus): Promise<void> {
    logger.debug('Updating experiment status', { experimentId, status });

    // Validate inputs
    validateExperimentId(experimentId);
    validateStatus(status);

    try {
      await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'update_status',
          dbPath: this.dbPath,
          experimentId,
          status,
        },
        SuccessResultSchema
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Preserve validation errors
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      throw new AppError(
        `Failed to update experiment status: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500,
        { experimentId, status }
      );
    }
  }

  async storeResults(experimentId: string, results: ExperimentResults): Promise<void> {
    logger.debug('Storing experiment results', { experimentId, results });

    // Validate inputs
    validateExperimentId(experimentId);
    if (results.tradesArtifactId) {
      validateArtifactId(results.tradesArtifactId);
    }
    if (results.metricsArtifactId) {
      validateArtifactId(results.metricsArtifactId);
    }
    if (results.curvesArtifactId) {
      validateArtifactId(results.curvesArtifactId);
    }
    if (results.diagnosticsArtifactId) {
      validateArtifactId(results.diagnosticsArtifactId);
    }

    try {
      await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'store_results',
          dbPath: this.dbPath,
          experimentId,
          results: {
            tradesArtifactId: results.tradesArtifactId,
            metricsArtifactId: results.metricsArtifactId,
            curvesArtifactId: results.curvesArtifactId,
            diagnosticsArtifactId: results.diagnosticsArtifactId,
          },
        },
        SuccessResultSchema
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Preserve validation errors
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      throw new AppError(
        `Failed to store experiment results: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500,
        { experimentId, results }
      );
    }
  }

  async findByInputArtifacts(artifactIds: string[]): Promise<Experiment[]> {
    logger.debug('Finding experiments by input artifacts', { artifactIds });

    // Validate inputs
    if (!Array.isArray(artifactIds)) {
      throw new AppError('Artifact IDs must be an array', 'VALIDATION_ERROR', 400);
    }
    if (artifactIds.length === 0) {
      return []; // Empty array returns empty results
    }
    artifactIds.forEach(validateArtifactId);

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'find_by_input_artifacts',
          dbPath: this.dbPath,
          artifactIds,
        },
        z.array(ExperimentSchema)
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Preserve validation errors
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      throw new AppError(
        `Failed to find experiments by input artifacts: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500,
        { artifactIds }
      );
    }
  }
}
