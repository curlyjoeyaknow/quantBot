/**
 * Feature Computation Registry
 *
 * Registry of feature functions with dependencies.
 * Features can depend on other features.
 */

import type { FeatureSetId, FeatureMetadata } from '@quantbot/core';

/**
 * Feature computation function
 */
export type FeatureComputeFn = (data: unknown) => Promise<Record<string, unknown>>;

/**
 * Feature registration
 */
export interface FeatureRegistration {
  /**
   * Feature set ID
   */
  featureSetId: FeatureSetId;

  /**
   * Feature name
   */
  name: string;

  /**
   * Feature version
   */
  version: string;

  /**
   * Computation function
   */
  computeFn: FeatureComputeFn;

  /**
   * Feature metadata
   */
  metadata: FeatureMetadata;

  /**
   * Dependencies on other feature sets
   */
  dependencies: FeatureSetId[];
}

/**
 * Feature Registry
 */
export class FeatureRegistry {
  private features: Map<FeatureSetId, FeatureRegistration> = new Map();

  /**
   * Register a feature
   *
   * @param name - Feature name
   * @param computeFn - Computation function
   * @param version - Feature version
   * @param metadata - Feature metadata
   * @param dependencies - Dependencies on other feature sets
   */
  registerFeature(
    name: string,
    computeFn: FeatureComputeFn,
    version: string,
    metadata: Omit<FeatureMetadata, 'version' | 'dependencies'>,
    dependencies: FeatureSetId[] = []
  ): FeatureSetId {
    const featureSetId = `${name}:${version}`;

    // Check for circular dependencies
    this.validateDependencies(featureSetId, dependencies);

    const registration: FeatureRegistration = {
      featureSetId,
      name,
      version,
      computeFn,
      metadata: {
        ...metadata,
        version,
        dependencies,
      },
      dependencies,
    };

    this.features.set(featureSetId, registration);

    return featureSetId;
  }

  /**
   * Get feature registration by ID
   */
  get(featureSetId: FeatureSetId): FeatureRegistration | null {
    return this.features.get(featureSetId) || null;
  }

  /**
   * List all registered features
   */
  list(): FeatureRegistration[] {
    return Array.from(this.features.values());
  }

  /**
   * Get feature dependencies (transitive)
   */
  getDependencies(featureSetId: FeatureSetId): Set<FeatureSetId> {
    const visited = new Set<FeatureSetId>();
    const stack: FeatureSetId[] = [featureSetId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;

      visited.add(current);
      const registration = this.features.get(current);
      if (registration) {
        for (const dep of registration.dependencies) {
          stack.push(dep);
        }
      }
    }

    // Remove the feature itself
    visited.delete(featureSetId);

    return visited;
  }

  /**
   * Validate dependencies (check for circular dependencies)
   */
  private validateDependencies(featureSetId: FeatureSetId, dependencies: FeatureSetId[]): void {
    for (const dep of dependencies) {
      if (dep === featureSetId) {
        throw new Error(`Circular dependency detected: ${featureSetId} depends on itself`);
      }

      const depRegistration = this.features.get(dep);
      if (depRegistration) {
        const transitiveDeps = this.getDependencies(dep);
        if (transitiveDeps.has(featureSetId)) {
          throw new Error(`Circular dependency detected: ${featureSetId} <-> ${dep}`);
        }
      }
    }
  }
}

/**
 * Global feature registry instance
 */
export const featureRegistry = new FeatureRegistry();
