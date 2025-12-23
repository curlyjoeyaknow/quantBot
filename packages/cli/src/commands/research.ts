/**
 * Research Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber } from '../core/coerce.js';
import type { CommandContext } from '../core/command-context.js';
import { listRunsHandler } from '../handlers/research/list-runs.js';
import { showRunHandler } from '../handlers/research/show-run.js';
import { runSimulationHandler } from '../handlers/research/run-simulation.js';
import { replaySimulationHandler } from '../handlers/research/replay-simulation.js';
import { batchSimulationHandler } from '../handlers/research/batch-simulation.js';
import { sweepSimulationHandler } from '../handlers/research/sweep-simulation.js';
import {
  researchListSchema,
  researchShowSchema,
  researchRunSchema,
  researchReplaySchema,
  researchBatchSchema,
  researchSweepSchema,
} from '../command-defs/research.js';

/**
 * Register research commands
 */
export function registerResearchCommands(program: Command): void {
  const researchCmd = program.command('research').description('Research OS experiment management');

  // List command
  const listCmd = researchCmd
    .command('list')
    .description('List all simulation runs')
    .option('--limit <n>', 'Maximum number of runs to list')
    .option('--offset <n>', 'Offset for pagination')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(listCmd, {
    name: 'list',
    packageName: 'research',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : undefined,
      offset: raw.offset ? coerceNumber(raw.offset, 'offset') : undefined,
    }),
    validate: (opts) => researchListSchema.parse(opts),
    onError: die,
  });

  // Show command
  const showCmd = researchCmd
    .command('show')
    .description('Show details of a specific simulation run')
    .requiredOption('--run-id <id>', 'Run ID to show')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(showCmd, {
    name: 'show',
    packageName: 'research',
    validate: (opts) => researchShowSchema.parse(opts),
    onError: die,
  });

  // Run command
  const runCmd = researchCmd
    .command('run')
    .description('Run a single simulation from a request JSON file')
    .requiredOption('--request-file <path>', 'Path to SimulationRequest JSON file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runCmd, {
    name: 'run',
    packageName: 'research',
    validate: (opts) => researchRunSchema.parse(opts),
    onError: die,
  });

  // Replay command
  const replayCmd = researchCmd
    .command('replay')
    .description('Replay a simulation by run ID')
    .requiredOption('--run-id <id>', 'Run ID to replay')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(replayCmd, {
    name: 'replay',
    packageName: 'research',
    validate: (opts) => researchReplaySchema.parse(opts),
    onError: die,
  });

  // Batch command
  const batchCmd = researchCmd
    .command('batch')
    .description('Run batch simulations from a batch JSON file')
    .requiredOption('--batch-file <path>', 'Path to BatchSimulationRequest JSON file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(batchCmd, {
    name: 'batch',
    packageName: 'research',
    validate: (opts) => researchBatchSchema.parse(opts),
    onError: die,
  });

  // Sweep command
  const sweepCmd = researchCmd
    .command('sweep')
    .description('Run parameter sweep from a sweep JSON file')
    .requiredOption('--sweep-file <path>', 'Path to ParameterSweepRequest JSON file')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(sweepCmd, {
    name: 'sweep',
    packageName: 'research',
    validate: (opts) => researchSweepSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const researchModule: PackageCommandModule = {
  packageName: 'research',
  description: 'Research OS experiment management',
  commands: [
    {
      name: 'list',
      description: 'List all simulation runs',
      schema: researchListSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchListSchema>;
        return await listRunsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research list', 'quantbot research list --limit 10 --offset 0'],
    },
    {
      name: 'show',
      description: 'Show details of a specific simulation run',
      schema: researchShowSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchShowSchema>;
        return await showRunHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research show --run-id run_abc123'],
    },
    {
      name: 'run',
      description: 'Run a single simulation from a request JSON file',
      schema: researchRunSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchRunSchema>;
        return await runSimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research run --request-file request.json'],
    },
    {
      name: 'replay',
      description: 'Replay a simulation by run ID',
      schema: researchReplaySchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchReplaySchema>;
        return await replaySimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research replay --run-id run_abc123'],
    },
    {
      name: 'batch',
      description: 'Run batch simulations from a batch JSON file',
      schema: researchBatchSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchBatchSchema>;
        return await batchSimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research batch --batch-file batch.json'],
    },
    {
      name: 'sweep',
      description: 'Run parameter sweep from a sweep JSON file',
      schema: researchSweepSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof researchSweepSchema>;
        return await sweepSimulationHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot research sweep --sweep-file sweep.json'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(researchModule);
