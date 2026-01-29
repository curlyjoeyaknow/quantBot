/**
 * Registry Rebuild Handler
 *
 * Rebuilds DuckDB registry from Parquet truth.
 * This is the high-leverage command that makes everything else
 * "just write append-only records and rebuild".
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import type { registryRebuildSchema } from '../../command-defs/registry.js';
import { PythonEngine } from '@quantbot/infra/utils';
import { join } from 'path';

export type RegistryRebuildArgs = z.infer<typeof registryRebuildSchema>;

/**
 * Result from registry rebuild
 */
export interface RegistryRebuildResult {
  /** Success status */
  success: boolean;
  /** Rebuild summary */
  summary: {
    /** Number of runsets loaded */
    runsets: number;
    /** Number of runs loaded */
    runs: number;
    /** Number of artifacts loaded */
    artifacts: number;
    /** Number of resolutions loaded */
    resolutions: number;
    /** Number of membership records derived */
    membership: number;
  };
  /** Tables loaded */
  tables: Record<string, number>;
  /** Duration in milliseconds */
  duration?: number;
  /** Message */
  message: string;
}

/**
 * Rebuild DuckDB registry from Parquet truth
 *
 * Pure handler - depends only on ports.
 * Uses PythonEngine to execute registry rebuild script.
 *
 * Steps:
 * 1. Scan Parquet registry tables
 * 2. Recreate DuckDB tables
 * 3. Derive membership table
 * 4. Create convenience views
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Rebuild summary
 *
 * @example
 * ```typescript
 * const result = await registryRebuildHandler(
 *   { force: true },
 *   ctx
 * );
 * console.log(`Rebuilt: ${result.summary.runsets} runsets, ${result.summary.runs} runs`);
 * ```
 */
export async function registryRebuildHandler(
  args: RegistryRebuildArgs,
  ctx: CommandContext
): Promise<RegistryRebuildResult> {
  // Get Python engine from context
  const pythonEngine = ctx.services.pythonEngine();

  // Get paths from environment or defaults
  const registryRoot = process.env.REGISTRY_ROOT || '/home/memez/opn/registry';
  const duckdbPath = process.env.REGISTRY_DB || join(process.cwd(), 'data/registry.duckdb');

  const startTime = Date.now();

  // Execute rebuild script
  const result = await pythonEngine.runScript(
    join(process.cwd(), 'tools/storage/runset_registry_rebuild.py'),
    {
      registry_root: registryRoot,
      duckdb_path: duckdbPath,
      force: args.force || false,
    },
    // Schema validation
    {
      success: true,
      summary: {
        runsets: 0,
        runs: 0,
        artifacts: 0,
        resolutions: 0,
        membership: 0,
      },
      tables: {},
    } as any // Will be validated by Python script output
  );

  const duration = Date.now() - startTime;

  return {
    success: result.success,
    summary: result.summary,
    tables: result.tables,
    duration,
    message: `Registry rebuilt successfully (${duration}ms)`,
  };
}

