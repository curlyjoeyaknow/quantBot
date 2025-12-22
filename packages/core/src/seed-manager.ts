/**
 * Seed Manager
 *
 * Generates deterministic seeds from run IDs and other inputs.
 * Ensures reproducible simulations.
 */

import { seedFromString } from './determinism.js';

/**
 * Seed Manager for generating deterministic seeds
 */
export class SeedManager {
  /**
   * Generate a deterministic seed from a run ID
   *
   * Same run ID → same seed (deterministic)
   */
  generateFromRunId(runId: string): number {
    return seedFromString(runId);
  }

  /**
   * Generate a seed from multiple inputs
   *
   * Combines multiple strings to create a unique seed.
   * Same inputs → same seed (deterministic)
   */
  generateFromInputs(...inputs: (string | number)[]): number {
    const combined = inputs.map(String).join('-');
    return seedFromString(combined);
  }

  /**
   * Generate a seed from a strategy ID and data snapshot hash
   *
   * Useful for ensuring same strategy + same data = same seed
   */
  generateFromStrategyAndData(strategyId: string, dataHash: string): number {
    return seedFromString(`${strategyId}-${dataHash}`);
  }

  /**
   * Generate a unique seed from experiment metadata
   *
   * Combines experiment ID, strategy name, and data snapshot hash
   */
  generateFromExperiment(
    experimentId: string,
    strategyName: string,
    dataSnapshotHash: string
  ): number {
    return seedFromString(`${experimentId}-${strategyName}-${dataSnapshotHash}`);
  }
}

/**
 * Default seed manager instance
 */
export const defaultSeedManager = new SeedManager();
