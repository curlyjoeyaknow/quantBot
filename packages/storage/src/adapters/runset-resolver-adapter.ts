/**
 * RunSet Resolver Adapter
 *
 * TypeScript adapter for RunSet resolver (Python implementation).
 * Implements RunSetResolverPort using PythonEngine.
 *
 * @packageDocumentation
 */

import { join } from 'path';
import { z } from 'zod';
import type { PythonEngine } from '@quantbot/infra/utils';
import type {
  RunSetResolverPort,
  CreateRunSetRequest,
  RunSetQueryFilter,
  RunSetSpec,
  RunSetResolution,
  RunSetWithResolution,
  Dataset,
  Run,
  DatasetId,
  ResolvedArtifact,
} from '@quantbot/core';

// ============================================================================
// Zod Schemas (Validation)
// ============================================================================

const ResolvedArtifactSchema = z.object({
  artifactId: z.string(),
  kind: z.string(),
  uri: z.string(),
  contentHash: z.string(),
  runId: z.string().optional(),
});

const RunSetResolutionSchema = z.object({
  runsetId: z.string(),
  resolverVersion: z.string(),
  resolvedAt: z.string(),
  runIds: z.array(z.string()),
  artifacts: z.array(ResolvedArtifactSchema),
  contentHash: z.string(),
  metadata: z.object({
    runCount: z.number(),
    artifactCount: z.number(),
    coverage: z
      .object({
        dateRange: z.object({
          from: z.string(),
          to: z.string(),
        }),
        runCount: z.number().optional(),
      })
      .optional(),
    warnings: z.array(z.string()).optional(),
  }),
  frozen: z.boolean(),
});

const RunSetSpecSchema = z.object({
  runsetId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  datasetId: z.string(),
  universe: z
    .object({
      chains: z.array(z.string()).optional(),
      venues: z.array(z.string()).optional(),
      tokenSources: z.array(z.string()).optional(),
      callers: z.array(z.string()).optional(),
      minMarketCap: z.number().optional(),
      maxMarketCap: z.number().optional(),
      minVolume: z.number().optional(),
    })
    .optional(),
  timeBounds: z.object({
    from: z.string(),
    to: z.string(),
    alertWindowPolicy: z.string().optional(),
  }),
  strategy: z
    .object({
      strategyFamily: z.string().optional(),
      strategyHash: z.string().optional(),
      engineVersion: z.string().optional(),
      paramConstraints: z.record(z.unknown()).optional(),
    })
    .optional(),
  tags: z.array(z.string()).optional(),
  latest: z.boolean().optional(),
  frozen: z.boolean().optional(),
  runIds: z.array(z.string()).optional(),
  createdAt: z.string(),
  specVersion: z.string(),
});

const RunSetWithResolutionSchema = z.object({
  spec: RunSetSpecSchema,
  resolution: RunSetResolutionSchema.optional(),
  mode: z.enum(['exploration', 'reproducible']),
});

const DatasetSchema = z.object({
  datasetId: z.string(),
  kind: z.string(),
  schemaVersion: z.string(),
  provenance: z.object({
    source: z.string(),
    extractedAt: z.string(),
    gitCommit: z.string().optional(),
  }),
  coverage: z.object({
    dateRange: z.object({
      from: z.string(),
      to: z.string(),
    }),
    chains: z.array(z.string()).optional(),
    venues: z.array(z.string()).optional(),
    completeness: z.number().optional(),
  }),
  createdAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

const RunSchema = z.object({
  runId: z.string(),
  datasetIds: z.array(z.string()),
  strategyHash: z.string(),
  engineVersion: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * RunSet Resolver Adapter
 *
 * Implements RunSetResolverPort using Python resolver.
 * Handles Parquet-first registry with DuckDB as cache.
 */
export class RunSetResolverAdapter implements RunSetResolverPort {
  private readonly registryRoot: string;
  private readonly duckdbPath: string;

  constructor(
    registryRoot: string,
    duckdbPath: string,
    private readonly pythonEngine: PythonEngine
  ) {
    this.registryRoot = registryRoot;
    this.duckdbPath = duckdbPath;
  }

  async createRunSet(request: CreateRunSetRequest): Promise<RunSetWithResolution> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'create_runset',
        registry_root: this.registryRoot,
        spec: request.spec,
      },
      RunSetWithResolutionSchema
    );

    return result;
  }

  async getRunSet(runsetId: string): Promise<RunSetWithResolution> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'get_runset',
        registry_root: this.registryRoot,
        runset_id: runsetId,
      },
      RunSetWithResolutionSchema
    );

    return result;
  }

  async queryRunSets(filter: RunSetQueryFilter): Promise<RunSetWithResolution[]> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'query_runsets',
        registry_root: this.registryRoot,
        filter,
      },
      z.array(RunSetWithResolutionSchema)
    );

    return result;
  }

  async resolveRunSet(runsetId: string, force?: boolean): Promise<RunSetResolution> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'resolve_runset',
        registry_root: this.registryRoot,
        runset_id: runsetId,
        force: force || false,
      },
      RunSetResolutionSchema
    );

    return result;
  }

  async freezeRunSet(runsetId: string): Promise<RunSetResolution> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'freeze_runset',
        registry_root: this.registryRoot,
        runset_id: runsetId,
      },
      RunSetResolutionSchema
    );

    return result;
  }

  async unfreezeRunSet(runsetId: string): Promise<void> {
    await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'unfreeze_runset',
        registry_root: this.registryRoot,
        runset_id: runsetId,
      },
      z.object({ success: z.boolean() })
    );
  }

  async deleteRunSet(runsetId: string): Promise<void> {
    await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'delete_runset',
        registry_root: this.registryRoot,
        runset_id: runsetId,
      },
      z.object({ success: z.boolean() })
    );
  }

  async registerDataset(dataset: Dataset): Promise<void> {
    await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'register_dataset',
        registry_root: this.registryRoot,
        dataset,
      },
      z.object({ success: z.boolean() })
    );
  }

  async getDataset(datasetId: DatasetId): Promise<Dataset> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'get_dataset',
        registry_root: this.registryRoot,
        dataset_id: datasetId,
      },
      DatasetSchema
    );

    return result;
  }

  async listDatasets(filter?: { kind?: string; limit?: number }): Promise<Dataset[]> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'list_datasets',
        registry_root: this.registryRoot,
        filter: filter || {},
      },
      z.array(DatasetSchema)
    );

    return result;
  }

  async registerRun(run: Run): Promise<void> {
    await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'register_run',
        registry_root: this.registryRoot,
        run,
      },
      z.object({ success: z.boolean() })
    );
  }

  async getRun(runId: string): Promise<Run> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'get_run',
        registry_root: this.registryRoot,
        run_id: runId,
      },
      RunSchema
    );

    return result;
  }

  async listRuns(filter?: {
    datasetIds?: DatasetId[];
    strategyHash?: string;
    status?: string;
    limit?: number;
  }): Promise<Run[]> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'list_runs',
        registry_root: this.registryRoot,
        filter: filter || {},
      },
      z.array(RunSchema)
    );

    return result;
  }

  async getResolutionHistory(runsetId: string, limit?: number): Promise<RunSetResolution[]> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'get_resolution_history',
        registry_root: this.registryRoot,
        runset_id: runsetId,
        limit: limit || 10,
      },
      z.array(RunSetResolutionSchema)
    );

    return result;
  }

  async validateSpec(spec: RunSetSpec): Promise<{
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  }> {
    const result = await this.pythonEngine.runScript(
      join(process.cwd(), 'tools/storage/runset_resolver.py'),
      {
        operation: 'validate_spec',
        registry_root: this.registryRoot,
        spec,
      },
      z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
        warnings: z.array(z.string()).optional(),
      })
    );

    return result;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.pythonEngine.runScript(
        join(process.cwd(), 'tools/storage/runset_resolver.py'),
        {
          operation: 'ping',
          registry_root: this.registryRoot,
        },
        z.object({ success: z.boolean() })
      );
      return true;
    } catch {
      return false;
    }
  }
}

