/**
 * Research OS - Context Factory
 * =============================
 *
 * Creates experiment contexts for running simulations.
 */

import { join } from 'path';
import type { ExperimentContext } from './experiment-runner.js';
import { FileArtifactStorage } from './artifact-storage.js';
import { createSimulationAdapter } from './simulation-adapter.js';
import type { WorkflowContext } from '../types.js';
import { createProductionContext } from '../context/createProductionContext.js';

/**
 * Configuration for experiment context
 */
export interface ExperimentContextConfig {
  /**
   * Base directory for artifact storage
   * Defaults to process.cwd()
   */
  artifactBaseDir?: string;

  /**
   * Workflow context (if not provided, creates default)
   */
  workflowContext?: WorkflowContext;
}

/**
 * Create an experiment context
 */
export function createExperimentContext(config: ExperimentContextConfig = {}): ExperimentContext {
  const workflowContext = config.workflowContext ?? createProductionContext();
  const artifactBaseDir = config.artifactBaseDir ?? process.cwd();

  const artifactStorage = new FileArtifactStorage(artifactBaseDir);
  const simulationAdapter = createSimulationAdapter(workflowContext);

  return {
    logger: workflowContext.logger,
    ids: workflowContext.ids,
    clock: {
      nowISO: () => workflowContext.clock.nowISO(),
    },
    artifacts: {
      save: async (artifact) => {
        await artifactStorage.save(artifact);
      },
      load: async (runId) => {
        return artifactStorage.load(runId);
      },
      list: async (options) => {
        return artifactStorage.list(options);
      },
    },
    simulation: {
      run: async (request) => {
        return simulationAdapter.run(request);
      },
    },
  };
}
