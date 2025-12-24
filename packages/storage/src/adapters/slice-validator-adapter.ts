/**
 * Slice Validator Adapter
 *
 * Validates slice manifests:
 * - Pure: JSON schema validation (AJV)
 * - Impure: File existence, Parquet readability, row count verification
 */

import { promises as fs, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import AjvClass from 'ajv';
import addFormats from 'ajv-formats';
import { logger } from '@quantbot/utils';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import type { SliceValidator } from '@quantbot/workflows';
import type { SliceManifestV1 } from '@quantbot/workflows';

// Load manifest schema from workflows package
// Using import.meta.url to get current file location, then navigate to workspace root
const __filename = fileURLToPath(import.meta.url);
// From packages/storage/src/adapters/slice-validator-adapter.ts
// Go up to workspace root: ../../../
const workspaceRoot = join(__filename, '..', '..', '..', '..', '..');
const manifestSchemaPath = join(workspaceRoot, 'packages', 'workflows', 'src', 'slices', 'manifest.schema.v1.json');
const manifestSchema = JSON.parse(readFileSync(manifestSchemaPath, 'utf-8'));

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Slice Validator Adapter Implementation
 */
export class SliceValidatorAdapter implements SliceValidator {
  private ajv: any; // Ajv instance
  private validateFn: any; // ValidateFunction from ajv

  constructor() {
    // Initialize AJV with formats support
    // AjvClass is the default export, but TypeScript needs explicit construction
    const Ajv = AjvClass as any;
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats.default(this.ajv);
    // Compile schema once
    this.validateFn = this.ajv.compile(manifestSchema);
  }

  async validate(manifest: SliceManifestV1): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Pure: JSON schema validation (AJV)
    const schemaValid = this.validateSchema(manifest);
    if (!schemaValid.ok) {
      errors.push(...schemaValid.errors);
    }

    // Impure: File existence checks
    for (const file of manifest.parquetFiles) {
      const path = file.path.replace(/^file:\/\//, '');
      try {
        await fs.access(path);
      } catch {
        errors.push(`Parquet file does not exist: ${file.path}`);
      }
    }

    // Impure: Optional DuckDB row count verification
    if (process.env.VALIDATE_ROW_COUNTS === 'true') {
      const rowCountValid = await this.verifyRowCounts(manifest);
      if (!rowCountValid.ok) {
        warnings.push(...rowCountValid.warnings);
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  /**
   * Pure: JSON schema validation
   */
  private validateSchema(manifest: unknown): ValidationResult {
    const valid = this.validateFn(manifest);

    if (!valid) {
      const errors = (this.validateFn.errors || []).map(
        (err: { instancePath?: string; message?: string }) => `${err.instancePath || '/'}: ${err.message || 'validation error'}`
      );
      return { ok: false, errors, warnings: [] };
    }

    return { ok: true, errors: [], warnings: [] };
  }

  /**
   * Impure: Verify row counts using DuckDB
   */
  private async verifyRowCounts(manifest: SliceManifestV1): Promise<ValidationResult> {
    const warnings: string[] = [];
    let db: DuckDBClient | null = null;

    try {
      db = new DuckDBClient(':memory:');
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      for (const file of manifest.parquetFiles) {
        const path = file.path.replace(/^file:\/\//, '');
        try {
          // Count rows in Parquet file
          const result = await db.query(
            `SELECT COUNT(*) as count FROM read_parquet('${path}')`
          );

          // DuckDBQueryResult has rows array, first row first column is the count
          const actualCount = result.rows.length > 0 && result.rows[0].length > 0
            ? (typeof result.rows[0][0] === 'number' ? result.rows[0][0] : Number(result.rows[0][0]))
            : 0;
          const expectedCount = file.rowCount;

          if (expectedCount !== undefined && actualCount !== expectedCount) {
            warnings.push(
              `Row count mismatch for ${file.path}: expected ${expectedCount}, got ${actualCount}`
            );
          }
        } catch (error) {
          warnings.push(`Could not verify row count for ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      warnings.push(`Row count verification failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (db) {
        await db.close();
      }
    }

    return { ok: warnings.length === 0, errors: [], warnings };
  }
}

/**
 * Create Slice Validator adapter
 */
export function createSliceValidatorAdapter(): SliceValidator {
  return new SliceValidatorAdapter();
}

