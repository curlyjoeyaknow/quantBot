/**
 * Handler for data feature-store list-versions command
 *
 * Lists all feature sets with their versions.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { DataFeatureStoreListVersionsArgs } from '../../command-defs/data.js';
import { openDuckDb, runSqlFile } from '@quantbot/storage';
import { join } from 'path';
import { existsSync } from 'fs';

export interface FeatureSetVersionInfo {
  featureSetId: string;
  featureSetVersion: string;
  featureSpecVersion: string;
  computedAtIso: string;
  computedBy?: string;
  createdAtIso: string;
}

export interface FeatureStoreListVersionsResult {
  featureSets: FeatureSetVersionInfo[];
  total: number;
}

/**
 * List all feature sets with version information
 */
export async function featureStoreListVersionsHandler(
  args: DataFeatureStoreListVersionsArgs,
  ctx: CommandContext
): Promise<FeatureStoreListVersionsResult> {
  // Determine catalog DB path (default: artifacts/catalog.duckdb)
  const catalogDbPath = process.env.CATALOG_DB_PATH || 'artifacts/catalog.duckdb';
  
  if (!existsSync(catalogDbPath)) {
    return { featureSets: [], total: 0 };
  }

  // Open catalog database
  const conn = await openDuckDb(catalogDbPath, { readOnly: true });
  
  try {
    // Ensure schema is initialized
    const schemaPath = join(process.cwd(), 'packages/lab/src/catalog/schema.sql');
    if (existsSync(schemaPath)) {
      await runSqlFile(conn, schemaPath);
    }

    // Query all feature sets
    const rows = await conn.all<any>(
      `SELECT 
        feature_set_id,
        feature_set_version,
        feature_spec_version,
        computed_at,
        computed_by,
        created_at
      FROM feature_sets
      ORDER BY created_at DESC`
    );

    const featureSets: FeatureSetVersionInfo[] = rows.map((row) => ({
      featureSetId: row.feature_set_id,
      featureSetVersion: row.feature_set_version || '1.0.0',
      featureSpecVersion: row.feature_spec_version || '1.0.0',
      computedAtIso: row.computed_at ? new Date(row.computed_at).toISOString() : new Date(row.created_at).toISOString(),
      computedBy: row.computed_by || undefined,
      createdAtIso: new Date(row.created_at).toISOString(),
    }));

    return {
      featureSets,
      total: featureSets.length,
    };
  } finally {
    await conn.close();
  }
}

