/**
 * Python Simulation Service
 *
 * Wraps PythonEngine calls to execute Python simulation scripts.
 * This service provides a clean interface for running simulations via Python.
 */

import { join } from 'path';
import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger, findWorkspaceRoot, ValidationError } from '@quantbot/utils';
import type { SimInput, SimResult } from '../sim/types/contracts.js';

/**
 * Supported contract versions (must match Python contracts.py)
 */
const SUPPORTED_CONTRACT_VERSIONS = ['1.0.0'];
const CURRENT_CONTRACT_VERSION = '1.0.0';

/**
 * SimResult schema for validation
 */
const SimResultSchema = z.object({
  run_id: z.string(),
  final_pnl: z.number(),
  events: z.array(
    z.object({
      event_type: z.string(),
      timestamp: z.number(),
      price: z.number(),
      quantity: z.number(),
      value_usd: z.number(),
      fee_usd: z.number(),
      pnl_usd: z.number().optional(),
      cumulative_pnl_usd: z.number().optional(),
      position_size: z.number(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  entry_price: z.number(),
  final_price: z.number(),
  total_candles: z.number(),
  metrics: z.object({
    max_drawdown: z.number().optional(),
    sharpe_ratio: z.number().optional(),
    win_rate: z.number().optional(),
    total_trades: z.number().optional(),
    profit_factor: z.number().optional(),
    average_win: z.number().optional(),
    average_loss: z.number().optional(),
  }),
});

export type SimResultOutput = z.infer<typeof SimResultSchema>;

/**
 * Python Simulation Service
 */
export class PythonSimulationService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run simulation using Python simulator
   *
   * @param simInput - Simulation input contract
   * @returns Simulation result
   */
  async runSimulation(simInput: SimInput): Promise<SimResultOutput> {
    // Validate contract version before calling Python
    if (!SUPPORTED_CONTRACT_VERSIONS.includes(simInput.contractVersion)) {
      throw new ValidationError(
        `Unsupported contract version: ${simInput.contractVersion}. ` +
          `Supported versions: ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}`,
        {
          contractVersion: simInput.contractVersion,
          supportedVersions: SUPPORTED_CONTRACT_VERSIONS,
        }
      );
    }

    try {
      // Resolve script path from workspace root
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      const scriptPath = join(workspaceRoot, 'tools/backtest/lib/simulation/simulator.py');

      // Convert SimInput to JSON for Python script
      const inputJson = JSON.stringify(simInput);

      // Run Python script via PythonEngine
      // Set PYTHONPATH to workspace root so Python can find tools module
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        inputJson,
        SimResultSchema,
        {
          timeout: 5 * 60 * 1000, // 5 minutes
          expectJsonOutput: true,
          cwd: workspaceRoot,
          env: {
            ...process.env,
            PYTHONPATH: workspaceRoot,
          },
        }
      );

      return result;
    } catch (error) {
      logger.error('Failed to run Python simulation', error as Error);
      throw error;
    }
  }

  /**
   * Validate Python simulation setup
   *
   * @returns Validation result
   */
  async validateSetup(): Promise<{
    valid: boolean;
    pythonVersion?: string;
    modulePath?: string;
    error?: string;
  }> {
    try {
      // Resolve script path from workspace root
      const { findWorkspaceRoot } = await import('@quantbot/utils');
      const workspaceRoot = findWorkspaceRoot();
      const scriptPath = join(workspaceRoot, 'tools/backtest/lib/simulation/simulator.py');

      // Check if script exists
      const { existsSync } = await import('fs');
      if (!existsSync(scriptPath)) {
        return {
          valid: false,
          error: `Simulation script not found: ${scriptPath}`,
        };
      }

      // Try to import Python script (basic validation)
      // This is a simple check - actual validation happens when running simulation
      return {
        valid: true,
        modulePath: scriptPath,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get supported contract versions
   */
  getSupportedVersions(): string[] {
    return [...SUPPORTED_CONTRACT_VERSIONS];
  }

  /**
   * Get current contract version
   */
  getCurrentVersion(): string {
    return CURRENT_CONTRACT_VERSION;
  }

  /**
   * Validate contract version
   *
   * @param version - Contract version to validate
   * @throws ValidationError if version is not supported
   */
  validateVersion(version: string): void {
    if (!SUPPORTED_CONTRACT_VERSIONS.includes(version)) {
      throw new ValidationError(
        `Unsupported contract version: ${version}. ` +
          `Supported versions: ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}`,
        {
          version,
          supportedVersions: SUPPORTED_CONTRACT_VERSIONS,
        }
      );
    }
  }
}
