/**
 * Experiment Registry Service
 *
 * Registers and tracks experiments before execution.
 */

import type { SimulationRunMetadata } from '@quantbot/storage';
import { generateExperimentIdFromMetadata } from '@quantbot/core';
import { getCurrentGitCommitHash, findWorkspaceRoot } from '@quantbot/utils';
import { DateTime } from 'luxon';
import type { PythonEngine } from '@quantbot/utils';
import { ParameterHashService } from './parameter-hash-service.js';
import { join } from 'path';
import { z } from 'zod';
import { logger } from '@quantbot/utils';

/**
 * Experiment registration data
 */
export interface ExperimentRegistration {
  /**
   * Unique experiment ID
   */
  experimentId: string;

  /**
   * Strategy ID
   */
  strategyId: string;

  /**
   * Data snapshot hash
   */
  dataSnapshotHash: string;

  /**
   * Parameter vector hash
   */
  parameterVectorHash: string;

  /**
   * Random seed
   */
  randomSeed: number;

  /**
   * Git commit hash
   */
  gitCommitHash: string;

  /**
   * Contract version
   */
  contractVersion: string;

  /**
   * Strategy version
   */
  strategyVersion?: string;

  /**
   * Data version
   */
  dataVersion?: string;

  /**
   * Registration timestamp
   */
  registeredAt: string;
}

/**
 * Experiment Registry Service
 */
export class ExperimentRegistry {
  private readonly parameterHashService: ParameterHashService;
  private readonly pythonEngine?: PythonEngine;

  constructor(pythonEngine?: PythonEngine) {
    // Store PythonEngine for deduplication checks
    this.pythonEngine = pythonEngine;
    // Create parameter hash service (Python computes, TypeScript orchestrates)
    this.parameterHashService = new ParameterHashService(pythonEngine);
  }

  /**
   * Register experiment before execution
   */
  async registerExperiment(params: {
    strategyId: string;
    strategyConfig: Record<string, unknown>;
    executionModel?: Record<string, unknown>;
    riskModel?: Record<string, unknown>;
    dataSnapshotHash: string;
    randomSeed: number;
    contractVersion?: string;
    strategyVersion?: string;
    dataVersion?: string;
  }): Promise<ExperimentRegistration> {
    // Compute parameter vector hash (Python computes, TypeScript orchestrates)
    const parameterVectorHash = await this.parameterHashService.computeParameterHash({
      strategyConfig: params.strategyConfig,
      executionModel: params.executionModel,
      riskModel: params.riskModel,
    });

    // Generate experiment ID
    const timestamp = DateTime.utc().toISO()!;
    const experimentId = generateExperimentIdFromMetadata({
      timestamp,
      strategyId: params.strategyId,
      dataSnapshotHash: params.dataSnapshotHash,
      parameterVectorHash,
    });

    // Get git commit hash
    const gitCommitHash = getCurrentGitCommitHash();

    return {
      experimentId,
      strategyId: params.strategyId,
      dataSnapshotHash: params.dataSnapshotHash,
      parameterVectorHash,
      randomSeed: params.randomSeed,
      gitCommitHash,
      contractVersion: params.contractVersion ?? '1.0.0',
      strategyVersion: params.strategyVersion,
      dataVersion: params.dataVersion,
      registeredAt: timestamp,
    };
  }

  /**
   * Convert registration to simulation run metadata
   */
  toSimulationRunMetadata(
    registration: ExperimentRegistration,
    baseMetadata: Partial<SimulationRunMetadata>
  ): SimulationRunMetadata {
    return {
      ...baseMetadata,
      experimentId: registration.experimentId,
      gitCommitHash: registration.gitCommitHash,
      dataSnapshotHash: registration.dataSnapshotHash,
      parameterVectorHash: registration.parameterVectorHash,
      randomSeed: registration.randomSeed,
      contractVersion: registration.contractVersion,
      strategyVersion: registration.strategyVersion,
      dataVersion: registration.dataVersion,
    } as SimulationRunMetadata;
  }

  /**
   * Check if experiment with same parameter vector hash already exists (deduplication)
   *
   * Phase IV: Python performs database queries, TypeScript orchestrates
   *
   * @param parameterVectorHash - Parameter vector hash to check
   * @param duckdbPath - Path to DuckDB database
   * @returns Existing experiment metadata if found, null otherwise
   */
  async checkDuplicate(
    parameterVectorHash: string,
    duckdbPath: string
  ): Promise<ExperimentRegistration | null> {
    if (!this.pythonEngine) {
      // PythonEngine not available - skip deduplication check
      logger.warn(
        '[ExperimentRegistry] PythonEngine not available, skipping deduplication check',
        { parameterVectorHash }
      );
      return null;
    }

    try {
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/backtest/lib/experiments/deduplicate.py');

      const inputJson = JSON.stringify({
        duckdbPath,
        parameterVectorHash,
      });

      const resultSchema = z.object({
        exists: z.boolean(),
        experiment: z
          .object({
            experimentId: z.string(),
            strategyId: z.string(),
            dataSnapshotHash: z.string(),
            parameterVectorHash: z.string(),
            gitCommitHash: z.string(),
            status: z.string(),
            createdAt: z.string(),
          })
          .optional(),
      });

      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        inputJson,
        resultSchema,
        {
          timeout: 30 * 1000, // 30 seconds
          expectJsonOutput: true,
          cwd: workspaceRoot,
          env: {
            ...process.env,
            PYTHONPATH: workspaceRoot,
          },
        }
      );

      if (result.exists && result.experiment) {
        // Return existing experiment registration
        return {
          experimentId: result.experiment.experimentId,
          strategyId: result.experiment.strategyId,
          dataSnapshotHash: result.experiment.dataSnapshotHash,
          parameterVectorHash: result.experiment.parameterVectorHash,
          randomSeed: 0, // Not available from query
          gitCommitHash: result.experiment.gitCommitHash,
          contractVersion: '1.0.0', // Default
          registeredAt: result.experiment.createdAt,
        };
      }

      return null;
    } catch (error) {
      logger.warn(
        '[ExperimentRegistry] Failed to check for duplicates via Python, continuing',
        {
          error: error instanceof Error ? error.message : String(error),
          parameterVectorHash,
        }
      );
      // On error, return null (don't block experiment registration)
      return null;
    }
  }
}
