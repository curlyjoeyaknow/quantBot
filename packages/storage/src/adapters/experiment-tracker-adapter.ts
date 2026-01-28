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
  strategy: z.record(z.unknown()),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
  params: z.record(z.unknown()),
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
      throw new AppError(
        `Failed to create experiment: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500
      );
    }
  }

  async getExperiment(experimentId: string): Promise<Experiment> {
    logger.debug('Getting experiment', { experimentId });

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
      if (message.includes('not found')) {
        throw new NotFoundError(`Experiment not found: ${experimentId}`);
      }
      throw new AppError(`Failed to get experiment: ${message}`, 'EXPERIMENT_TRACKER_ERROR', 500);
    }
  }

  async listExperiments(filter: ExperimentFilter): Promise<Experiment[]> {
    logger.debug('Listing experiments', { filter });

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
      throw new AppError(`Failed to list experiments: ${message}`, 'EXPERIMENT_TRACKER_ERROR', 500);
    }
  }

  async updateStatus(experimentId: string, status: ExperimentStatus): Promise<void> {
    logger.debug('Updating experiment status', { experimentId, status });

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
      throw new AppError(
        `Failed to update experiment status: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500
      );
    }
  }

  async storeResults(experimentId: string, results: ExperimentResults): Promise<void> {
    logger.debug('Storing experiment results', { experimentId, results });

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
      throw new AppError(
        `Failed to store experiment results: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500
      );
    }
  }

  async findByInputArtifacts(artifactIds: string[]): Promise<Experiment[]> {
    logger.debug('Finding experiments by input artifacts', { artifactIds });

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
      throw new AppError(
        `Failed to find experiments by input artifacts: ${message}`,
        'EXPERIMENT_TRACKER_ERROR',
        500
      );
    }
  }
}
