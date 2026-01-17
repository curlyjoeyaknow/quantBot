/**
 * Experiment Registry Service
 *
 * Registers and tracks experiments before execution.
 */

import type { SimulationRunMetadata } from '@quantbot/infra/storage';
import { generateExperimentIdFromMetadata } from '@quantbot/core';
import { serializeSimulationParameters, hashParameterVector } from '@quantbot/core';
import { getCurrentGitCommitHash } from '@quantbot/infra/utils';
import { DateTime } from 'luxon';

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
  /**
   * Register experiment before execution
   */
  registerExperiment(params: {
    strategyId: string;
    strategyConfig: Record<string, unknown>;
    executionModel?: Record<string, unknown>;
    riskModel?: Record<string, unknown>;
    dataSnapshotHash: string;
    randomSeed: number;
    contractVersion?: string;
    strategyVersion?: string;
    dataVersion?: string;
  }): ExperimentRegistration {
    // Serialize parameters to vector
    const parameterVector = serializeSimulationParameters({
      strategyConfig: params.strategyConfig,
      executionModel: params.executionModel,
      riskModel: params.riskModel,
    });

    const parameterVectorHash = hashParameterVector(parameterVector);

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
}
