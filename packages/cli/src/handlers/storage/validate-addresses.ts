/**
 * Validate Addresses Handler
 *
 * Scans DuckDB database for faulty addresses (truncated, invalid format, etc.)
 */

import path from 'node:path';
import { ConfigurationError } from '@quantbot/utils';
import { PythonEngine } from '@quantbot/utils';
import { DuckDBStorageService } from '@quantbot/simulation';
import type { CommandContext } from '../../core/command-context.js';
import { validateAddressesSchema } from '../../commands/storage.js';
import type { z } from 'zod';
import { logger } from '@quantbot/utils';

export type ValidateAddressesArgs = z.infer<typeof validateAddressesSchema>;

export async function validateAddressesHandler(args: ValidateAddressesArgs, _ctx: CommandContext) {
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdbPath',
      { args, env: { DUCKDB_PATH: process.env.DUCKDB_PATH } }
    );
  }
  const duckdbPath = path.resolve(duckdbPathRaw);

  logger.info('Validating addresses in DuckDB database', { duckdbPath });

  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);

  const result = await duckdbStorage.validateAddresses(duckdbPath);

  if (!result.success) {
    throw new Error(`Failed to validate addresses: ${result.error || 'Unknown error'}`);
  }

  logger.info('Address validation complete', {
    total: result.total_addresses,
    valid: result.valid_addresses,
    faulty: result.faulty_addresses,
  });

  if (result.faulty && result.faulty.length > 0) {
    logger.warn(`Found ${result.faulty.length} faulty addresses`);

    // Group by error type for summary
    const errorGroups = new Map<string, number>();
    for (const faulty of result.faulty) {
      const key = faulty.error;
      errorGroups.set(key, (errorGroups.get(key) || 0) + 1);
    }

    logger.info('Faulty addresses by error type', {
      errorTypes: Array.from(errorGroups.entries()).map(([error, count]) => ({
        error,
        count,
      })),
    });

    // Show first 20 faulty addresses as examples
    const examples = result.faulty.slice(0, 20);
    logger.info('Example faulty addresses (first 20)', {
      examples: examples.map((f) => ({
        mint: f.mint,
        table: f.table_name,
        rows: f.row_count,
        error: f.error,
        length: f.address_length,
        type: f.address_type,
      })),
    });
  }

  return {
    success: true,
    duckdb: duckdbPath,
    total_addresses: result.total_addresses,
    valid_addresses: result.valid_addresses,
    faulty_addresses: result.faulty_addresses,
    faulty: result.faulty,
  };
}
