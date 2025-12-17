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

import { parseArguments, normalizeOptions } from './argument-parser.js';
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
  type ArtifactPaths,
} from './artifact-manager.js';
import { errorToContract } from './error-contracts.js';
import { commandRegistry } from './command-registry.js';

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
 * Execute a command definition with raw options
 */
export async function execute(
  commandDef: CommandDefinition,
  rawOptions: Record<string, unknown>
): Promise<void> {
  let runId: string | undefined;
  let artifactPaths: ArtifactPaths | undefined;
  const packageName = findPackageName(commandDef.name);
  const fullCommandName = packageName ? `${packageName}.${commandDef.name}` : commandDef.name;

  try {
    // 1. Normalize options (handles --flag value and --flag=value)
    const normalized = normalizeOptions(rawOptions);

    // 2. Parse and validate arguments
    const args = parseArguments(commandDef.schema, normalized) as Record<string, unknown>;

    // 3. Generate run ID and create artifact directory (if applicable)
    const runIdComponents = extractRunIdComponents(commandDef.name, packageName, args);
    if (runIdComponents) {
      runId = generateRunId(runIdComponents);
      const artifactsDir = process.env.ARTIFACTS_DIR || './artifacts';
      artifactPaths = await createArtifactDirectory(runIdComponents, artifactsDir);
    }

    // 4. Create context and ensure initialization
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

    // 6. Call handler (pure use-case function)
    const result = await commandDef.handler(handlerArgs, ctx);

    // 7. Persist artifacts (if applicable)
    if (artifactPaths && runId) {
      await writeArtifact(artifactPaths, 'resultsJson', result);
      await writeArtifact(artifactPaths, 'metricsJson', {
        runId,
        timestamp: new Date().toISOString(),
        command: fullCommandName,
        packageName,
        commandName: commandDef.name,
      });

      // If result has events, write them as CSV
      if (result && typeof result === 'object' && 'events' in result) {
        const events = (result as { events?: unknown[] }).events;
        if (Array.isArray(events) && events.length > 0) {
          await writeCsvArtifact(artifactPaths, events as Array<Record<string, unknown>>);
        }
      }
    }

    // 8. Format and print output
    const output = formatOutput(result, format);
    console.log(output);
  } catch (error) {
    // 9. Log error contract to artifacts (if applicable)
    if (artifactPaths && runId) {
      const contract = errorToContract(error, fullCommandName, runId);
      await writeArtifact(artifactPaths, 'logsTxt', JSON.stringify(contract, null, 2));
    }

    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
