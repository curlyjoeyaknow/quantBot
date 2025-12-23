/**
 * Universal Command Executor
 *
 * Handles all the boring universal stuff:
 * - Normalize options
 * - Parse arguments (Zod validation)
 * - Initialize context (storage)
 * - Call handler
 * - Format output
 * - Error handling
 * - Run ID generation and artifact management
 */

import { validateAndCoerceArgs } from './validation-pipeline.js';
import { formatOutput } from './output-formatter.js';
import { handleError } from './error-handler.js';
import { CommandContext } from './command-context.js';
import type { CommandDefinition } from '../types/index.js';
import type { OutputFormat } from '../types/index.js';
import { generateRunId, shouldGenerateRunId, type RunIdComponents } from './run-id-manager.js';
import {
  createArtifactDirectory,
  writeArtifact,
  writeCsvArtifact,
  writeNdjsonArtifact,
  type ArtifactPaths,
} from './artifact-manager.js';
import { createAndWriteRunManifest, type RunManifestComponents } from './run-manifest-service.js';
import { seedFromString } from '@quantbot/core';
import { errorToContract } from './error-contracts.js';
import { normalizeOptions, parseArguments } from './argument-parser.js';

/**
 * Extract manifest components from handler result
 *
 * Handlers can return a result with `_manifest` property containing manifest components.
 * This allows workflows to provide full manifest information.
 */
function extractManifestComponents(
  result: unknown,
  defaults: { runId: string; command: string; packageName?: string; seed: number }
): RunManifestComponents | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const obj = result as Record<string, unknown>;

  // Check if result has _manifest property (explicit manifest components)
  if ('_manifest' in obj && typeof obj._manifest === 'object' && obj._manifest !== null) {
    const manifest = obj._manifest as Record<string, unknown>;
    return {
      runId: defaults.runId,
      seed: (manifest.seed as number) ?? defaults.seed,
      strategyConfig: manifest.strategyConfig ?? {},
      dataSnapshot: (manifest.dataSnapshot as RunManifestComponents['dataSnapshot']) ?? {
        calls: [],
      },
      executionModel: manifest.executionModel,
      costModel: manifest.costModel,
      riskModel: manifest.riskModel,
      engineVersion: (manifest.engineVersion as string) ?? '1.0.0',
      command: defaults.command,
      packageName: defaults.packageName,
      metadata: manifest.metadata as Record<string, unknown> | undefined,
    };
  }

  // Try to extract from result structure (for simulation results)
  if ('strategy' in obj || 'strategyConfig' in obj) {
    const strategyConfig = obj.strategyConfig ?? obj.strategy ?? {};
    const dataSnapshot = {
      calls: (obj.calls as Array<{ mint: string; alertTimestamp: string }>) ?? [],
      candles:
        'candles' in obj && Array.isArray(obj.candles)
          ? (obj.candles as Array<{ mint: string; fromISO: string; toISO: string }>)
          : undefined,
    };

    return {
      runId: defaults.runId,
      seed: defaults.seed,
      strategyConfig,
      dataSnapshot,
      executionModel: obj.executionModel,
      costModel: obj.costModel,
      riskModel: obj.riskModel,
      command: defaults.command,
      packageName: defaults.packageName,
    };
  }

  return null;
}

/**
 * Extract seed from result (if available)
 */
function extractSeedFromResult(result: unknown): number | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const obj = result as Record<string, unknown>;
  if ('seed' in obj && typeof obj.seed === 'number') {
    return obj.seed;
  }
  if ('_manifest' in obj && typeof obj._manifest === 'object' && obj._manifest !== null) {
    const manifest = obj._manifest as Record<string, unknown>;
    if ('seed' in manifest && typeof manifest.seed === 'number') {
      return manifest.seed;
    }
  }
  return null;
}
import { commandRegistry } from './command-registry.js';
import { getProgressIndicator, resetProgressIndicator } from './progress-indicator.js';
import { closeClickHouse } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

/**
 * Find package name for a command by searching the registry
 */
function findPackageName(commandName: string): string | undefined {
  for (const pkg of commandRegistry.getPackages()) {
    const cmd = commandRegistry.getCommand(pkg.packageName, commandName);
    if (cmd) {
      return pkg.packageName;
    }
  }
  return undefined;
}

/**
 * Check if command args contain run ID components
 */
function extractRunIdComponents(
  commandName: string,
  packageName: string | undefined,
  args: Record<string, unknown>
): RunIdComponents | null {
  const fullCommandName = packageName ? `${packageName}.${commandName}` : commandName;

  if (!shouldGenerateRunId(fullCommandName)) {
    return null;
  }

  // Extract components from args (common fields for simulation commands)
  const strategyId = (args.strategyId as string) || (args.strategy as string) || 'default';
  const mint = (args.mint as string) || 'unknown';
  const alertTimestamp =
    (args.alertTimestamp as string) || (args.alert_timestamp as string) || new Date().toISOString();
  const callerName = (args.callerName as string) || (args.caller_name as string) || undefined;

  return {
    command: fullCommandName,
    strategyId,
    mint,
    alertTimestamp,
    callerName,
  };
}

/**
 * Execute a command definition with pre-validated arguments
 *
 * Use this when arguments have already been validated (e.g., from defineCommand).
 * Skips normalization and validation steps.
 */
export async function executeValidated(
  commandDef: CommandDefinition,
  validatedArgs: Record<string, unknown>
): Promise<void> {
  let runId: string | undefined;
  let artifactPaths: ArtifactPaths | undefined;
  const packageName = findPackageName(commandDef.name);
  const fullCommandName = packageName ? `${packageName}.${commandDef.name}` : commandDef.name;

  const progress = getProgressIndicator();

  try {
    // Check for verbose flag early to disable spinner
    const isVerboseMode = (validatedArgs as { verbose?: boolean }).verbose === true;
    if (isVerboseMode) {
      // Don't start spinner in verbose mode - let verbose output handle it
    } else {
      progress.start('Initializing...');
    }

    // Use validated args directly (no normalization/validation needed)
    const args = validatedArgs;

    // Generate run ID and create artifact directory (if applicable)
    const runIdComponents = extractRunIdComponents(commandDef.name, packageName, args);
    if (runIdComponents) {
      runId = generateRunId(runIdComponents);
      const artifactsDir = process.env.ARTIFACTS_DIR || './artifacts';
      if (!isVerboseMode) {
        progress.updateMessage('Creating artifact directory...');
      }
      artifactPaths = await createArtifactDirectory(runIdComponents, artifactsDir);
    }

    // Create context and ensure initialization
    if (!isVerboseMode) {
      progress.updateMessage('Initializing services...');
    }
    const ctx = new CommandContext();
    await ctx.ensureInitialized();

    // Extract format (if present) before calling handler
    // Format is CLI concern, not handler concern
    const format = (args as { format?: OutputFormat }).format ?? 'table';
    const handlerArgs = { ...args };
    // Remove format from handler args if it exists
    if ('format' in handlerArgs) {
      delete (handlerArgs as { format?: OutputFormat }).format;
    }

    // Stop spinner if verbose mode is enabled (to avoid interfering with verbose output)
    if (isVerboseMode) {
      progress.stop();
    } else {
      progress.updateMessage(`Running ${fullCommandName}...`);
    }

    // Call handler (pure use-case function)
    const result = await commandDef.handler(handlerArgs, ctx);

    // Persist artifacts (if applicable)
    if (artifactPaths && runId) {
      progress.updateMessage('Saving artifacts...');

      // Extract manifest components from result (if available)
      const manifestComponents = extractManifestComponents(result, {
        runId,
        command: fullCommandName,
        packageName,
        seed: extractSeedFromResult(result) ?? seedFromString(runId),
      });

      // Create and write manifest (required for all runs)
      if (manifestComponents) {
        await createAndWriteRunManifest(artifactPaths, manifestComponents);
      } else {
        // Fallback: create minimal manifest if components not available
        await createAndWriteRunManifest(artifactPaths, {
          runId,
          seed: seedFromString(runId),
          strategyConfig: {},
          dataSnapshot: { calls: [] },
          command: fullCommandName,
          packageName,
        });
      }

      // Write legacy results.json (for backward compatibility)
      await writeArtifact(artifactPaths, 'resultsJson', result);

      // Write metrics.json
      await writeArtifact(artifactPaths, 'metricsJson', {
        runId,
        timestamp: new Date().toISOString(),
        command: fullCommandName,
        packageName,
        commandName: commandDef.name,
      });

      // If result has events, write them as NDJSON (new format) and CSV (legacy)
      if (result && typeof result === 'object' && 'events' in result) {
        const events = (result as { events?: unknown[] }).events;
        if (Array.isArray(events) && events.length > 0) {
          // Write NDJSON (new format)
          await writeNdjsonArtifact(
            artifactPaths,
            'eventsNdjson',
            events as Array<Record<string, unknown>>
          );
          // Write CSV (legacy format, for backward compatibility)
          await writeCsvArtifact(artifactPaths, events as Array<Record<string, unknown>>);
        }
      }

      // If result has positions, write them as NDJSON
      if (result && typeof result === 'object' && 'positions' in result) {
        const positions = (result as { positions?: unknown[] }).positions;
        if (Array.isArray(positions) && positions.length > 0) {
          await writeNdjsonArtifact(
            artifactPaths,
            'positionsNdjson',
            positions as Array<Record<string, unknown>>
          );
        }
      }
    }

    // Format and print output
    progress.updateMessage('Formatting output...');
    const output = formatOutput(result, format);
    progress.stop(); // Stop spinner before printing output
    console.log(output);
  } catch (error) {
    progress.fail('Error occurred');
    // Log error contract to artifacts (if applicable)
    if (artifactPaths && runId) {
      const contract = errorToContract(error, fullCommandName, runId);
      await writeArtifact(artifactPaths, 'debugLog', JSON.stringify(contract, null, 2));
      // Also write to legacy logsTxt for backward compatibility
      if (artifactPaths.logsTxt) {
        await writeArtifact(artifactPaths, 'logsTxt', JSON.stringify(contract, null, 2));
      }
    }

    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  } finally {
    // Always clean up connections and progress indicator to allow process to exit
    await closeClickHouse().catch((err) => {
      // Ignore errors during cleanup - we're exiting anyway
      logger.debug('Error closing ClickHouse during cleanup', { error: err });
    });
    resetProgressIndicator();
  }
}

/**
 * Execute a command definition with raw options
 *
 * This is the entry point for raw Commander.js options.
 * It normalizes and validates arguments before calling the handler.
 *
 * For pre-validated arguments, use executeValidated() instead.
 */
export async function execute(
  commandDef: CommandDefinition,
  rawOptions: Record<string, unknown>
): Promise<void> {
  let runId: string | undefined;
  let artifactPaths: ArtifactPaths | undefined;
  const packageName = findPackageName(commandDef.name);
  const fullCommandName = packageName ? `${packageName}.${commandDef.name}` : commandDef.name;

  const progress = getProgressIndicator();

  try {
    // Check for verbose flag early to disable spinner
    const isVerboseMode = (rawOptions as { verbose?: boolean }).verbose === true;
    if (isVerboseMode) {
      // Don't start spinner in verbose mode - let verbose output handle it
    } else {
      // 1. Normalize options (handles --flag value and --flag=value)
      progress.start('Parsing arguments...');
    }
    const normalized = normalizeOptions(rawOptions);

    // 2. Parse and validate arguments
    const args = parseArguments(commandDef.schema, normalized) as Record<string, unknown>;
    if (!isVerboseMode) {
      progress.updateMessage('Validating configuration...');
    }

    // 3. Generate run ID and create artifact directory (if applicable)
    const runIdComponents = extractRunIdComponents(commandDef.name, packageName, args);
    if (runIdComponents) {
      runId = generateRunId(runIdComponents);
      const artifactsDir = process.env.ARTIFACTS_DIR || './artifacts';
      if (!isVerboseMode) {
        progress.updateMessage('Creating artifact directory...');
      }
      artifactPaths = await createArtifactDirectory(runIdComponents, artifactsDir);
    }

    // 4. Create context and ensure initialization
    if (!isVerboseMode) {
      progress.updateMessage('Initializing services...');
    }
    const ctx = new CommandContext();
    await ctx.ensureInitialized();

    // 5. Extract format (if present) before calling handler
    // Format is CLI concern, not handler concern
    const format = (args as { format?: OutputFormat }).format ?? 'table';
    const handlerArgs = { ...(args as Record<string, unknown>) };
    // Remove format from handler args if it exists
    if ('format' in handlerArgs) {
      delete (handlerArgs as { format?: OutputFormat }).format;
    }

    // 6. Stop spinner if verbose mode is enabled (to avoid interfering with verbose output)
    if (isVerboseMode) {
      progress.stop();
    } else {
      progress.updateMessage(`Running ${fullCommandName}...`);
    }

    // 7. Call handler (pure use-case function)
    const result = await commandDef.handler(handlerArgs, ctx);

    // 7. Persist artifacts (if applicable)
    if (artifactPaths && runId) {
      progress.updateMessage('Saving artifacts...');

      // Extract manifest components from result (if available)
      const manifestComponents = extractManifestComponents(result, {
        runId,
        command: fullCommandName,
        packageName,
        seed: extractSeedFromResult(result) ?? seedFromString(runId),
      });

      // Create and write manifest (required for all runs)
      if (manifestComponents) {
        await createAndWriteRunManifest(artifactPaths, manifestComponents);
      } else {
        // Fallback: create minimal manifest if components not available
        await createAndWriteRunManifest(artifactPaths, {
          runId,
          seed: seedFromString(runId),
          strategyConfig: {},
          dataSnapshot: { calls: [] },
          command: fullCommandName,
          packageName,
        });
      }

      // Write legacy results.json (for backward compatibility)
      await writeArtifact(artifactPaths, 'resultsJson', result);

      // Write metrics.json
      await writeArtifact(artifactPaths, 'metricsJson', {
        runId,
        timestamp: new Date().toISOString(),
        command: fullCommandName,
        packageName,
        commandName: commandDef.name,
      });

      // If result has events, write them as NDJSON (new format) and CSV (legacy)
      if (result && typeof result === 'object' && 'events' in result) {
        const events = (result as { events?: unknown[] }).events;
        if (Array.isArray(events) && events.length > 0) {
          // Write NDJSON (new format)
          await writeNdjsonArtifact(
            artifactPaths,
            'eventsNdjson',
            events as Array<Record<string, unknown>>
          );
          // Write CSV (legacy format, for backward compatibility)
          await writeCsvArtifact(artifactPaths, events as Array<Record<string, unknown>>);
        }
      }

      // If result has positions, write them as NDJSON
      if (result && typeof result === 'object' && 'positions' in result) {
        const positions = (result as { positions?: unknown[] }).positions;
        if (Array.isArray(positions) && positions.length > 0) {
          await writeNdjsonArtifact(
            artifactPaths,
            'positionsNdjson',
            positions as Array<Record<string, unknown>>
          );
        }
      }
    }

    // 8. Format and print output
    progress.updateMessage('Formatting output...');
    const output = formatOutput(result, format);
    progress.stop(); // Stop spinner before printing output
    console.log(output);
  } catch (error) {
    progress.fail('Error occurred');
    // 9. Log error contract to artifacts (if applicable)
    if (artifactPaths && runId) {
      const contract = errorToContract(error, fullCommandName, runId);
      await writeArtifact(artifactPaths, 'debugLog', JSON.stringify(contract, null, 2));
      // Also write to legacy logsTxt for backward compatibility
      if (artifactPaths.logsTxt) {
        await writeArtifact(artifactPaths, 'logsTxt', JSON.stringify(contract, null, 2));
      }
    }

    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  } finally {
    // Always clean up connections and progress indicator to allow process to exit
    await closeClickHouse().catch((err) => {
      // Ignore errors during cleanup - we're exiting anyway
      logger.debug('Error closing ClickHouse during cleanup', { error: err });
    });
    resetProgressIndicator();
  }
}
