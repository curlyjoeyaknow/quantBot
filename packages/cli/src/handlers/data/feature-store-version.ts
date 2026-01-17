/**
 * Handler for data feature-store version command
 *
 * Gets version information for a feature set.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { DataFeatureStoreVersionArgs } from '../../command-defs/data.js';
import { openDuckDb, DuckDbCatalogAdapter, runSqlFile } from '@quantbot/storage';
import { join } from 'path';
import { existsSync } from 'fs';

export interface FeatureStoreVersionResult {
  featureSetId: string;
  featureSetVersion: string;
  featureSpecVersion: string;
  computedAtIso: string;
  computedBy?: string;
  createdAtIso: string;
}

/**
 * Get feature store version information
 */
export async function featureStoreVersionHandler(
  args: DataFeatureStoreVersionArgs,
  ctx: CommandContext
): Promise<FeatureStoreVersionResult | null> {
  // Determine catalog DB path (default: artifacts/catalog.duckdb)
  const catalogDbPath = process.env.CATALOG_DB_PATH || 'artifacts/catalog.duckdb';
  
  if (!existsSync(catalogDbPath)) {
    throw new Error(`Catalog database not found at ${catalogDbPath}. Run lab simulation first to create catalog.`);
  }

  // Open catalog database
  const conn = await openDuckDb(catalogDbPath, { readOnly: true });
  
  try {
    // Ensure schema is initialized
    const schemaPath = join(process.cwd(), 'packages/lab/src/catalog/schema.sql');
    if (existsSync(schemaPath)) {
      await runSqlFile(conn, schemaPath);
    }

    const catalog = new DuckDbCatalogAdapter(conn);
    const featureSet = await catalog.getFeatureSet(args.featureSetId);

    if (!featureSet) {
      return null;
    }

    return {
      featureSetId: featureSet.featureSetId,
      featureSetVersion: featureSet.featureSetVersion || '1.0.0',
      featureSpecVersion: featureSet.featureSpecVersion || '1.0.0',
      computedAtIso: featureSet.computedAtIso || featureSet.createdAtIso,
      computedBy: featureSet.computedBy,
      createdAtIso: featureSet.createdAtIso,
    };
  } finally {
    await conn.close();
  }
}

