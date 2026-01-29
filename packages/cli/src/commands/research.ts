/**
 * Research Package Commands
 *
 * CLI commands for research package operations:
 * - Artifact store (Parquet + SQLite manifest)
 * - Experiment tracking (DuckDB with artifact lineage)
 * - Experiment execution (frozen artifact sets)
 *
 * @packageDocumentation
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import type { PackageCommandModule } from '../types/index.js';

// Artifact schemas
import {
  listResearchArtifactsSchema,
  getResearchArtifactSchema,
  findResearchArtifactSchema,
  getResearchArtifactLineageSchema,
  getResearchArtifactDownstreamSchema,
} from '../command-defs/research-artifacts.js';

// Experiment schemas
import {
  createResearchExperimentSchema,
  executeResearchExperimentSchema,
  getResearchExperimentSchema,
  listResearchExperimentsSchema,
  findResearchExperimentsByInputsSchema,
} from '../command-defs/research-experiments.js';

// Artifact handlers
import { listResearchArtifactsHandler } from '../handlers/research/artifacts/list-artifacts.js';
import { getResearchArtifactHandler } from '../handlers/research/artifacts/get-artifact.js';
import { findResearchArtifactHandler } from '../handlers/research/artifacts/find-artifact.js';
import { getResearchArtifactLineageHandler } from '../handlers/research/artifacts/get-lineage.js';
import { getResearchArtifactDownstreamHandler } from '../handlers/research/artifacts/get-downstream.js';

// Experiment handlers
import { createResearchExperimentHandler } from '../handlers/research/experiments/create-experiment.js';
import { executeResearchExperimentHandler } from '../handlers/research/experiments/execute-experiment.js';
import { getResearchExperimentHandler } from '../handlers/research/experiments/get-experiment.js';
import { listResearchExperimentsHandler } from '../handlers/research/experiments/list-experiments.js';
import { findResearchExperimentsByInputsHandler } from '../handlers/research/experiments/find-by-inputs.js';

/**
 * Register research package commands
 */
export function registerResearchCommands(program: Command): void {
  const researchCmd = program
    .command('research')
    .description('Research package operations (artifact store, experiments)');

  // ============================================================================
  // Artifact Store Commands
  // ============================================================================

  const artifactsCmd = researchCmd
    .command('artifacts')
    .description('Artifact store operations (Parquet + SQLite manifest)');

  // List artifacts
  const listArtifactsCmd = artifactsCmd
    .command('list')
    .description('List artifacts from artifact store')
    .option('--type <type>', 'Filter by artifact type (e.g., alerts_v1, ohlcv_slice_v2)')
    .option('--status <status>', 'Filter by status (active|superseded|tombstoned)')
    .option('--limit <n>', 'Limit number of results', '100')
    .option('--format <format>', 'Output format (json|table|csv)', 'table');

  defineCommand(listArtifactsCmd, {
    name: 'artifacts-list',
    packageName: 'research',
    validate: (opts) => listResearchArtifactsSchema.parse(opts),
    onError: die,
  });

  // Get artifact
  const getArtifactCmd = artifactsCmd
    .command('get <artifactId>')
    .description('Get artifact by ID')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(getArtifactCmd, {
    name: 'artifacts-get',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      artifactId: args[0],
    }),
    validate: (opts) => getResearchArtifactSchema.parse(opts),
    onError: die,
  });

  // Find artifact
  const findArtifactCmd = artifactsCmd
    .command('find')
    .description('Find artifacts by logical key')
    .option('--type <type>', 'Artifact type (required)')
    .option('--key <key>', 'Logical key (required)')
    .option('--format <format>', 'Output format (json|table|csv)', 'table');

  defineCommand(findArtifactCmd, {
    name: 'artifacts-find',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      logicalKey: rawOpts.key,
    }),
    validate: (opts) => findResearchArtifactSchema.parse(opts),
    onError: die,
  });

  // Get lineage
  const lineageCmd = artifactsCmd
    .command('lineage <artifactId>')
    .description('Get artifact lineage (input artifacts)')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(lineageCmd, {
    name: 'artifacts-lineage',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      artifactId: args[0],
    }),
    validate: (opts) => getResearchArtifactLineageSchema.parse(opts),
    onError: die,
  });

  // Get downstream
  const downstreamCmd = artifactsCmd
    .command('downstream <artifactId>')
    .description('Get downstream artifacts (outputs that depend on this artifact)')
    .option('--format <format>', 'Output format (json|table|csv)', 'table');

  defineCommand(downstreamCmd, {
    name: 'artifacts-downstream',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      artifactId: args[0],
    }),
    validate: (opts) => getResearchArtifactDownstreamSchema.parse(opts),
    onError: die,
  });

  // ============================================================================
  // Experiment Commands
  // ============================================================================

  const experimentsCmd = researchCmd
    .command('experiments')
    .description('Experiment tracking and execution');

  // Create experiment
  const createExperimentCmd = experimentsCmd
    .command('create')
    .description('Create a new experiment with frozen artifact sets')
    .option('--name <name>', 'Experiment name (required)')
    .option('--description <desc>', 'Optional description')
    .option('--alerts <ids...>', 'Alert artifact IDs (comma-separated)')
    .option('--ohlcv <ids...>', 'OHLCV artifact IDs (comma-separated)')
    .option('--strategies <ids...>', 'Strategy artifact IDs (optional)')
    .option('--strategy <json>', 'Strategy configuration (JSON)')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--params <json>', 'Additional parameters (JSON)')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(createExperimentCmd, {
    name: 'experiments-create',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => {
      // Parse JSON fields if provided as strings
      const strategy =
        typeof rawOpts.strategy === 'string' ? JSON.parse(rawOpts.strategy) : rawOpts.strategy;
      const params =
        typeof rawOpts.params === 'string' ? JSON.parse(rawOpts.params) : rawOpts.params;

      return {
        ...rawOpts,
        strategy,
        params,
      };
    },
    validate: (opts) => createResearchExperimentSchema.parse(opts),
    onError: die,
  });

  // Execute experiment
  const executeExperimentCmd = experimentsCmd
    .command('execute <experimentId>')
    .description('Execute an experiment')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(executeExperimentCmd, {
    name: 'experiments-execute',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      experimentId: args[0],
    }),
    validate: (opts) => executeResearchExperimentSchema.parse(opts),
    onError: die,
  });

  // Get experiment
  const getExperimentCmd = experimentsCmd
    .command('get <experimentId>')
    .description('Get experiment by ID')
    .option('--format <format>', 'Output format (json|table)', 'table');

  defineCommand(getExperimentCmd, {
    name: 'experiments-get',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      experimentId: args[0],
    }),
    validate: (opts) => getResearchExperimentSchema.parse(opts),
    onError: die,
  });

  // List experiments
  const listExperimentsCmd = experimentsCmd
    .command('list')
    .description('List experiments with optional filters')
    .option('--status <status>', 'Filter by status (pending|running|completed|failed|cancelled)')
    .option('--git-commit <hash>', 'Filter by git commit')
    .option('--min-created <date>', 'Filter by minimum creation date (ISO 8601)')
    .option('--max-created <date>', 'Filter by maximum creation date (ISO 8601)')
    .option('--limit <n>', 'Limit number of results', '100')
    .option('--format <format>', 'Output format (json|table|csv)', 'table');

  defineCommand(listExperimentsCmd, {
    name: 'experiments-list',
    packageName: 'research',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      gitCommit: rawOpts['git-commit'] || rawOpts.gitCommit,
      minCreatedAt: rawOpts['min-created'] || rawOpts.minCreatedAt,
      maxCreatedAt: rawOpts['max-created'] || rawOpts.maxCreatedAt,
    }),
    validate: (opts) => listResearchExperimentsSchema.parse(opts),
    onError: die,
  });

  // Find by inputs
  const findByInputsCmd = experimentsCmd
    .command('find-by-inputs')
    .description('Find experiments by input artifact IDs')
    .option('--artifacts <ids...>', 'Artifact IDs to search for (comma-separated)')
    .option('--format <format>', 'Output format (json|table|csv)', 'table');

  defineCommand(findByInputsCmd, {
    name: 'experiments-find-by-inputs',
    packageName: 'research',
    validate: (opts) => findResearchExperimentsByInputsSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const researchModule: PackageCommandModule = {
  packageName: 'research',
  description: 'Research package operations (artifact store, experiments)',
  commands: [
    // Artifact commands
    {
      name: 'artifacts-list',
      description: 'List artifacts from artifact store',
      schema: listResearchArtifactsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof listResearchArtifactsSchema>;
        return await listResearchArtifactsHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot research artifacts list',
        'quantbot research artifacts list --type alerts_v1 --limit 5',
        'quantbot research artifacts list --status active --format json',
      ],
    },
    {
      name: 'artifacts-get',
      description: 'Get artifact by ID',
      schema: getResearchArtifactSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof getResearchArtifactSchema>;
        return await getResearchArtifactHandler(typedArgs, ctx);
      },
      examples: ['quantbot research artifacts get 88f07b79-621c-4d6b-ae39-a2c71c995703'],
    },
    {
      name: 'artifacts-find',
      description: 'Find artifacts by logical key',
      schema: findResearchArtifactSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof findResearchArtifactSchema>;
        return await findResearchArtifactHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot research artifacts find --type alerts_v1 --key "day=2025-05-01/chain=solana"',
      ],
    },
    {
      name: 'artifacts-lineage',
      description: 'Get artifact lineage (input artifacts)',
      schema: getResearchArtifactLineageSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof getResearchArtifactLineageSchema>;
        return await getResearchArtifactLineageHandler(typedArgs, ctx);
      },
      examples: ['quantbot research artifacts lineage experiment-trades-123'],
    },
    {
      name: 'artifacts-downstream',
      description: 'Get downstream artifacts',
      schema: getResearchArtifactDownstreamSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof getResearchArtifactDownstreamSchema>;
        return await getResearchArtifactDownstreamHandler(typedArgs, ctx);
      },
      examples: ['quantbot research artifacts downstream alerts-123'],
    },
    // Experiment commands
    {
      name: 'experiments-create',
      description: 'Create a new experiment',
      schema: createResearchExperimentSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof createResearchExperimentSchema>;
        return await createResearchExperimentHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot research experiments create --name "momentum-v1" --alerts alert-1,alert-2 --ohlcv ohlcv-1 --from 2025-05-01 --to 2025-05-31',
      ],
    },
    {
      name: 'experiments-execute',
      description: 'Execute an experiment',
      schema: executeResearchExperimentSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof executeResearchExperimentSchema>;
        return await executeResearchExperimentHandler(typedArgs, ctx);
      },
      examples: ['quantbot research experiments execute exp-20260129120000-abc123'],
    },
    {
      name: 'experiments-get',
      description: 'Get experiment by ID',
      schema: getResearchExperimentSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof getResearchExperimentSchema>;
        return await getResearchExperimentHandler(typedArgs, ctx);
      },
      examples: ['quantbot research experiments get exp-20260129120000-abc123'],
    },
    {
      name: 'experiments-list',
      description: 'List experiments',
      schema: listResearchExperimentsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof listResearchExperimentsSchema>;
        return await listResearchExperimentsHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot research experiments list',
        'quantbot research experiments list --status completed --limit 10',
      ],
    },
    {
      name: 'experiments-find-by-inputs',
      description: 'Find experiments by input artifacts',
      schema: findResearchExperimentsByInputsSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof findResearchExperimentsByInputsSchema>;
        return await findResearchExperimentsByInputsHandler(typedArgs, ctx);
      },
      examples: ['quantbot research experiments find-by-inputs --artifacts alert-1,ohlcv-1'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(researchModule);
