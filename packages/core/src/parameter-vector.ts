/**
 * Parameter Vector Serialization
 *
 * Serializes strategy config + execution model + risk model → parameter vector.
 * Used for experiment tracking and comparison.
 */

import { createHash } from 'crypto';

/**
 * Parameter vector (flat key-value representation)
 */
export interface ParameterVector {
  [key: string]: string | number | boolean | null;
}

/**
 * Serialize strategy config to parameter vector
 */
export function serializeStrategyConfig(
  config: Record<string, unknown>,
  prefix: string = 'strategy'
): ParameterVector {
  const vector: ParameterVector = {};

  function flatten(obj: unknown, keyPrefix: string): void {
    if (obj === null || obj === undefined) {
      vector[keyPrefix] = null;
      return;
    }

    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      vector[keyPrefix] = obj;
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        flatten(item, `${keyPrefix}[${index}]`);
      });
      return;
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = keyPrefix ? `${keyPrefix}.${key}` : key;
        flatten(value, newKey);
      }
      return;
    }
  }

  flatten(config, prefix);
  return vector;
}

/**
 * Serialize execution model to parameter vector
 */
export function serializeExecutionModel(
  model: Record<string, unknown>,
  prefix: string = 'execution'
): ParameterVector {
  return serializeStrategyConfig(model, prefix);
}

/**
 * Serialize risk model to parameter vector
 */
export function serializeRiskModel(
  model: Record<string, unknown>,
  prefix: string = 'risk'
): ParameterVector {
  return serializeStrategyConfig(model, prefix);
}

/**
 * Combine parameter vectors
 */
export function combineParameterVectors(...vectors: ParameterVector[]): ParameterVector {
  return vectors.reduce((combined, vector) => ({ ...combined, ...vector }), {});
}

/**
 * Hash parameter vector for quick comparison
 */
export function hashParameterVector(vector: ParameterVector): string {
  // Sort keys for deterministic hashing
  const sorted = Object.keys(vector)
    .sort()
    .map((key) => `${key}=${JSON.stringify(vector[key])}`)
    .join('&');

  return createHash('sha256').update(sorted).digest('hex');
}

/**
 * Serialize all simulation parameters to parameter vector
 */
export function serializeSimulationParameters(params: {
  strategyConfig: Record<string, unknown>;
  executionModel?: Record<string, unknown>;
  riskModel?: Record<string, unknown>;
}): ParameterVector {
  const strategy = serializeStrategyConfig(params.strategyConfig);
  const execution = params.executionModel ? serializeExecutionModel(params.executionModel) : {};
  const risk = params.riskModel ? serializeRiskModel(params.riskModel) : {};

  return combineParameterVectors(strategy, execution, risk);
}
