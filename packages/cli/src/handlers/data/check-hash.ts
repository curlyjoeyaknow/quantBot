/**
 * Handler for data check-hash command
 *
 * Checks if a raw data hash exists in the database (for idempotency).
 */

import type { CommandContext } from '../../core/command-context.js';
import type { DataCheckHashArgs } from '../../command-defs/data.js';
import { RawDataHashRepository } from '@quantbot/storage';
import { existsSync } from 'fs';

export interface CheckHashResult {
  hash: string;
  exists: boolean;
  foundAt?: string;
  sourceType?: string;
  sourcePath?: string;
}

/**
 * Check if a raw data hash exists
 */
export async function checkHashHandler(
  args: DataCheckHashArgs,
  ctx: CommandContext
): Promise<CheckHashResult> {
  // Determine DuckDB path (default: data/tele.duckdb)
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  
  if (!existsSync(duckdbPath)) {
    return {
      hash: args.hash,
      exists: false,
    };
  }

  // Create repository
  const repo = await RawDataHashRepository.fromPath(duckdbPath, true);
  
  try {
    const result = await repo.checkHash(args.hash);

    if (!result.exists) {
      return {
        hash: args.hash,
        exists: false,
      };
    }

    return {
      hash: args.hash,
      exists: true,
      foundAt: result.record?.ingestedAt.toISOString(),
      sourceType: result.record?.sourceType,
      sourcePath: result.record?.sourcePath,
    };
  } finally {
    await repo.close();
  }
}
