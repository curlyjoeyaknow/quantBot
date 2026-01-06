/**
 * DuckDB Artifact Adapter
 *
 * Implements ArtifactRepository port using DuckDB for storage.
 */

import { join } from 'path';
import { z } from 'zod';
import type { ArtifactRepository, ArtifactQueryFilter } from '@quantbot/core';
import type { Artifact, ArtifactMetadata } from '@quantbot/core';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger, NotFoundError, AppError, findWorkspaceRoot } from '../../utils/index.js';

const ArtifactResultSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
  content: z.record(z.string(), z.unknown()),
});

const ArtifactListResultSchema = z.array(ArtifactResultSchema);

/**
 * DuckDB Artifact Adapter
 */
export class ArtifactDuckDBAdapter implements ArtifactRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_artifacts.py');
  }

  async store(artifact: Artifact): Promise<void> {
    try {
      await this.client.execute(
        this.scriptPath,
        'store',
        { data: JSON.stringify(artifact) },
        z.object({ success: z.boolean() })
      );
    } catch (error) {
      logger.error('Failed to store artifact', error as Error, {
        artifactId: artifact.metadata.id,
      });
      throw error;
    }
  }

  async get(id: string, version: string): Promise<Artifact | null> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get',
        { data: JSON.stringify({ id, version }) },
        z.union([ArtifactResultSchema, z.object({ error: z.string() })])
      );

      if ('error' in result) {
        return null;
      }

      return result as Artifact;
    } catch (error) {
      logger.error('Failed to get artifact', error as Error, { id, version });
      return null;
    }
  }

  async getLatest(id: string): Promise<Artifact | null> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get_latest',
        { data: JSON.stringify({ id }) },
        z.union([ArtifactResultSchema, z.object({ error: z.string() })])
      );

      if ('error' in result) {
        return null;
      }

      return result as Artifact;
    } catch (error) {
      logger.error('Failed to get latest artifact', error as Error, { id });
      return null;
    }
  }

  async listVersions(id: string): Promise<Artifact[]> {
    try {
      const results = await this.client.execute(
        this.scriptPath,
        'list_versions',
        { data: JSON.stringify({ id }) },
        ArtifactListResultSchema
      );

      return results as Artifact[];
    } catch (error) {
      logger.error('Failed to list artifact versions', error as Error, { id });
      return [];
    }
  }

  async query(filter: ArtifactQueryFilter): Promise<Artifact[]> {
    try {
      const results = await this.client.execute(
        this.scriptPath,
        'query',
        { data: JSON.stringify(filter) },
        ArtifactListResultSchema
      );

      return results as Artifact[];
    } catch (error) {
      logger.error('Failed to query artifacts', error as Error, { filter });
      return [];
    }
  }

  async tag(id: string, version: string, tags: string[]): Promise<void> {
    // Get artifact, update tags, store again
    const artifact = await this.get(id, version);
    if (!artifact) {
      throw new NotFoundError('Artifact', `${id}@${version}`, { id, version });
    }

    artifact.metadata.tags = tags;
    await this.store(artifact);
  }

  async getMetadata(id: string, version: string): Promise<ArtifactMetadata | null> {
    const artifact = await this.get(id, version);
    return artifact?.metadata ?? null;
  }

  async listMetadata(filter?: ArtifactQueryFilter): Promise<ArtifactMetadata[]> {
    const artifacts = await this.query(filter ?? {});
    return artifacts.map((a) => a.metadata);
  }

  async delete(id: string, version: string): Promise<void> {
    // TODO: Implement delete operation in Python script
    throw new AppError('Delete operation not yet implemented', 'NOT_IMPLEMENTED', 501, {
      operation: 'delete',
      id,
      version,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to initialize schema to check availability
      await this.client.initSchema(this.scriptPath);
      return true;
    } catch {
      return false;
    }
  }
}
