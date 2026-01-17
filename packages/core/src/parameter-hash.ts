/**
 * Parameter vector hashing for deduplication
 *
 * Prevents duplicate experiment runs with identical parameters.
 */

import { createHash } from 'crypto';
import { z } from 'zod';

export const ParameterVectorSchema = z.record(z.unknown());

export type ParameterVector = z.infer<typeof ParameterVectorSchema>;

export const ParameterHashSchema = z.object({
  parameterHash: z.string(),
  parameters: ParameterVectorSchema,
  createdAt: z.number(),
  experimentIds: z.array(z.string()),
});

export type ParameterHash = z.infer<typeof ParameterHashSchema>;

/**
 * Compute parameter vector hash
 */
export function computeParameterHash(parameters: ParameterVector): string {
  // Sort keys for consistent hashing
  const sorted = Object.keys(parameters)
    .sort()
    .reduce((acc, key) => {
      acc[key] = parameters[key];
      return acc;
    }, {} as ParameterVector);

  const normalized = JSON.stringify(sorted);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Parameter hash repository interface
 */
export interface ParameterHashRepository {
  /**
   * Store a parameter hash
   */
  put(hash: ParameterHash): Promise<void>;

  /**
   * Get parameter hash
   */
  get(parameterHash: string): Promise<ParameterHash | null>;

  /**
   * Check if parameters already exist
   */
  exists(parameterHash: string): Promise<boolean>;

  /**
   * Add experiment ID to existing hash
   */
  addExperiment(parameterHash: string, experimentId: string): Promise<void>;

  /**
   * Get all experiment IDs for parameters
   */
  getExperiments(parameterHash: string): Promise<string[]>;

  /**
   * Delete a parameter hash
   */
  delete(parameterHash: string): Promise<void>;
}

/**
 * In-memory parameter hash repository
 */
export class InMemoryParameterHashRepository implements ParameterHashRepository {
  private hashes: Map<string, ParameterHash> = new Map();

  async put(hash: ParameterHash): Promise<void> {
    this.hashes.set(hash.parameterHash, hash);
  }

  async get(parameterHash: string): Promise<ParameterHash | null> {
    return this.hashes.get(parameterHash) || null;
  }

  async exists(parameterHash: string): Promise<boolean> {
    return this.hashes.has(parameterHash);
  }

  async addExperiment(parameterHash: string, experimentId: string): Promise<void> {
    const hash = this.hashes.get(parameterHash);
    if (!hash) {
      throw new Error(`Parameter hash not found: ${parameterHash}`);
    }

    if (!hash.experimentIds.includes(experimentId)) {
      hash.experimentIds.push(experimentId);
    }
  }

  async getExperiments(parameterHash: string): Promise<string[]> {
    const hash = this.hashes.get(parameterHash);
    return hash ? [...hash.experimentIds] : [];
  }

  async delete(parameterHash: string): Promise<void> {
    this.hashes.delete(parameterHash);
  }

  /**
   * Clear all hashes (for testing)
   */
  clear(): void {
    this.hashes.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalHashes: number;
    totalExperiments: number;
    avgExperimentsPerHash: number;
  } {
    let totalExperiments = 0;
    for (const hash of this.hashes.values()) {
      totalExperiments += hash.experimentIds.length;
    }

    return {
      totalHashes: this.hashes.size,
      totalExperiments,
      avgExperimentsPerHash: this.hashes.size > 0 ? totalExperiments / this.hashes.size : 0,
    };
  }
}

/**
 * Parameter deduplication service
 */
export class ParameterDeduplicationService {
  constructor(private readonly repository: ParameterHashRepository) {}

  /**
   * Register parameters for an experiment
   * Returns existing experiments with same parameters (if any)
   */
  async register(
    experimentId: string,
    parameters: ParameterVector
  ): Promise<{ isDuplicate: boolean; existingExperiments: string[] }> {
    const parameterHash = computeParameterHash(parameters);

    const existing = await this.repository.get(parameterHash);

    if (existing) {
      // Duplicate parameters found
      await this.repository.addExperiment(parameterHash, experimentId);
      return {
        isDuplicate: true,
        existingExperiments: existing.experimentIds,
      };
    }

    // New parameters
    await this.repository.put({
      parameterHash,
      parameters,
      createdAt: Date.now(),
      experimentIds: [experimentId],
    });

    return {
      isDuplicate: false,
      existingExperiments: [],
    };
  }

  /**
   * Check if parameters are duplicate without registering
   */
  async isDuplicate(parameters: ParameterVector): Promise<boolean> {
    const parameterHash = computeParameterHash(parameters);
    return this.repository.exists(parameterHash);
  }

  /**
   * Find experiments with same parameters
   */
  async findDuplicates(parameters: ParameterVector): Promise<string[]> {
    const parameterHash = computeParameterHash(parameters);
    return this.repository.getExperiments(parameterHash);
  }

  /**
   * Get parameters for an experiment (by finding matching hash)
   */
  async getParameters(experimentId: string): Promise<ParameterVector | null> {
    // This is inefficient for large datasets - in production use reverse index
    for (const hash of await this.getAllHashes()) {
      if (hash.experimentIds.includes(experimentId)) {
        return hash.parameters;
      }
    }
    return null;
  }

  /**
   * Get all parameter hashes (for internal use)
   */
  private async getAllHashes(): Promise<ParameterHash[]> {
    // This would need to be implemented in the repository interface
    // For now, this is a placeholder
    return [];
  }
}

/**
 * Compare two parameter vectors
 */
export function compareParameters(
  params1: ParameterVector,
  params2: ParameterVector
): {
  identical: boolean;
  added: string[];
  removed: string[];
  changed: string[];
} {
  const keys1 = new Set(Object.keys(params1));
  const keys2 = new Set(Object.keys(params2));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  // Check for added keys
  for (const key of keys2) {
    if (!keys1.has(key)) {
      added.push(key);
    }
  }

  // Check for removed and changed keys
  for (const key of keys1) {
    if (!keys2.has(key)) {
      removed.push(key);
    } else if (JSON.stringify(params1[key]) !== JSON.stringify(params2[key])) {
      changed.push(key);
    }
  }

  const identical = added.length === 0 && removed.length === 0 && changed.length === 0;

  return { identical, added, removed, changed };
}
