/**
 * Parameter Hash Service
 *
 * Computes parameter vector hash using Python (Phase IV: Python computes, TypeScript orchestrates).
 * Falls back to TypeScript computation if PythonEngine not available (backward compatibility).
 */

import { join } from 'path';
import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { findWorkspaceRoot, logger } from '@quantbot/utils';
import { serializeSimulationParameters, hashParameterVector, type ParameterVector } from '@quantbot/core';

/**
 * Parameter hash service
 */
export class ParameterHashService {
  constructor(private readonly pythonEngine?: PythonEngine) {
    // PythonEngine is optional for backward compatibility
    // If provided, uses Python for hash computation (Phase IV)
    // Otherwise, falls back to TypeScript computation
  }

  /**
   * Compute parameter vector hash from simulation parameters
   *
   * Phase IV: Python computes hash, TypeScript orchestrates via PythonEngine
   * Falls back to TypeScript computation if PythonEngine not available
   */
  async computeParameterHash(params: {
    strategyConfig: Record<string, unknown>;
    executionModel?: Record<string, unknown>;
    riskModel?: Record<string, unknown>;
  }): Promise<string> {
    // Use Python for hash computation if PythonEngine is available (Phase IV)
    if (this.pythonEngine) {
      try {
        const workspaceRoot = findWorkspaceRoot();
        const scriptPath = join(workspaceRoot, 'tools/backtest/lib/experiments/hash_parameters.py');

        const inputJson = JSON.stringify({
          strategyConfig: params.strategyConfig,
          executionModel: params.executionModel,
          riskModel: params.riskModel,
        });

        const resultSchema = z.object({
          hash: z.string().regex(/^[a-f0-9]{64}$/),
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

        return result.hash;
      } catch (error) {
        logger.warn(
          '[ParameterHashService] Failed to compute hash via Python, falling back to TypeScript',
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Fall through to TypeScript computation
      }
    }

    // Fallback: TypeScript computation (backward compatibility)
    const parameterVector = serializeSimulationParameters({
      strategyConfig: params.strategyConfig,
      executionModel: params.executionModel,
      riskModel: params.riskModel,
    });

    return hashParameterVector(parameterVector);
  }
}

