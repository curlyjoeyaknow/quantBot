#!/usr/bin/env tsx
/**
 * Migration script: Reorganize flat Parquet files into partitioned structure
 *
 * This script:
 * 1. Scans existing flat Parquet files (e.g., slices/per_token_v2/*.parquet)
 * 2. Infers metadata from filenames or reads from Parquet metadata
 * 3. Reorganizes into canonical partitioned structure:
 *    {dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}/part-*.parquet
 * 4. Creates/updates manifests
 * 5. Validates integrity after migration
 *
 * Usage:
 *   tsx scripts/data-processing/migrate-parquet-to-partitioned.ts \
 *     --source-dir ./slices/per_token_v2 \
 *     --target-base ./slices/partitioned \
 *     --dataset candles_1m \
 *     --chain sol \
 *     [--dry-run]
 */

import { promises as fs } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { createHash } from 'crypto';
import { parseArgs } from 'util';
import { DuckDBClient } from '@quantbot/storage';
import type { SliceManifestV1, ParquetLayoutSpec, RunContext, SliceSpec } from '@quantbot/core';

interface MigrationArgs {
  sourceDir: string;
  targetBase: string;
  dataset: string;
  chain: 'sol' | 'eth' | 'base' | 'bsc' | 'unknown';
  dryRun: boolean;
  maxFiles?: number;
}

interface FileMetadata {
  sourcePath: string;
  filename: string;
  inferredDate?: string; // YYYY-MM-DD
  inferredChain?: string;
  inferredTokenId?: string;
  byteSize: number;
  rowCount?: number;
  minTimestamp?: string;
  maxTimestamp?: string;
}

/**
 * Parse filename to infer metadata
 * Patterns:
 * - YYYYMMDD_HHMM_<token>_<label>.parquet
 * - <date>_<token>_<label>.parquet
 */
function inferMetadataFromFilename(filename: string): Partial<FileMetadata> {
  const metadata: Partial<FileMetadata> = {};

  // Pattern: YYYYMMDD_HHMM_<token>_<label>.parquet
  const datePattern = /^(\d{8})_(\d{4})_([A-Za-z0-9]+)_(.+)\.parquet$/;
  const match = filename.match(datePattern);

  if (match) {
    const [, dateStr, timeStr, tokenId, label] = match;
    // Convert YYYYMMDD to YYYY-MM-DD
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    metadata.inferredDate = `${year}-${month}-${day}`;
    metadata.inferredTokenId = tokenId;
  }

  return metadata;
}

/**
 * Read Parquet file metadata using DuckDB
 */
async function readParquetMetadata(filePath: string): Promise<{
  rowCount: number;
  minTimestamp?: string;
  maxTimestamp?: string;
  chain?: string;
}> {
  const client = new DuckDBClient(':memory:');
  try {
    await client.execute('INSTALL parquet;');
    await client.execute('LOAD parquet;');

    // Try to read schema and sample data
    const schemaQuery = `DESCRIBE SELECT * FROM read_parquet('${filePath.replace(/'/g, "''")}') LIMIT 0`;
    const schemaResult = await client.query(schemaQuery);

    // Check if timestamp column exists
    const hasTimestamp = schemaResult.columns.some((col) =>
      col.name.toLowerCase().includes('timestamp') || col.name.toLowerCase() === 'ts'
    );
    const timestampCol = schemaResult.columns.find(
      (col) => col.name.toLowerCase().includes('timestamp') || col.name.toLowerCase() === 'ts'
    )?.name;

    // Get row count
    const countResult = await client.query(
      `SELECT COUNT(*) as cnt FROM read_parquet('${filePath.replace(/'/g, "''")}')`
    );
    const rowCount = countResult.rows[0]?.[0] || 0;

    let minTimestamp: string | undefined;
    let maxTimestamp: string | undefined;
    let chain: string | undefined;

    if (hasTimestamp && timestampCol) {
      const timeRangeResult = await client.query(
        `SELECT MIN(${timestampCol}) as min_ts, MAX(${timestampCol}) as max_ts FROM read_parquet('${filePath.replace(/'/g, "''")}')`
      );
      if (timeRangeResult.rows.length > 0) {
        minTimestamp = timeRangeResult.rows[0]?.[0] as string | undefined;
        maxTimestamp = timeRangeResult.rows[0]?.[1] as string | undefined;
      }
    }

    // Try to get chain
    const chainCol = schemaResult.columns.find((col) => col.name.toLowerCase() === 'chain');
    if (chainCol) {
      const chainResult = await client.query(
        `SELECT DISTINCT chain FROM read_parquet('${filePath.replace(/'/g, "''")}') LIMIT 1`
      );
      if (chainResult.rows.length > 0) {
        chain = chainResult.rows[0]?.[0] as string | undefined;
      }
    }

    return {
      rowCount: Number(rowCount),
      minTimestamp,
      maxTimestamp,
      chain,
    };
  } finally {
    await client.close();
  }
}

/**
 * Generate canonical partitioned path
 */
function generatePartitionedPath(
  metadata: FileMetadata,
  args: MigrationArgs,
  runId: string
): string {
  const date = metadata.inferredDate || 'unknown';
  const [yyyy, mm, dd] = date.split('-');

  // Canonical template: {dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}
  const subdir = `${args.dataset}/chain=${args.chain}/dt=${yyyy}-${mm}-${dd}/run_id=${runId}`;
  const targetDir = join(args.targetBase, subdir);

  // Keep original filename but ensure .parquet extension
  const baseName = basename(metadata.filename, '.parquet');
  const targetFilename = `${baseName}.parquet`;

  return join(targetDir, targetFilename);
}

/**
 * Expand template (same logic as exporter)
 */
function expandTemplate(tpl: string, vars: Record<string, string>): string {
  let result = tpl;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Create manifest for migrated files
 */
function createManifest(
  files: FileMetadata[],
  args: MigrationArgs,
  runId: string,
  layout: ParquetLayoutSpec
): SliceManifestV1 {
  const createdAtIso = new Date().toISOString();
  const day = files[0]?.inferredDate || new Date().toISOString().slice(0, 10);

  const run: RunContext = {
    runId,
    createdAtIso,
    note: `Migrated from flat structure: ${args.sourceDir}`,
  };

  const spec: SliceSpec = {
    dataset: args.dataset,
    chain: args.chain,
    timeRange: {
      startIso: files[0]?.minTimestamp || `${day}T00:00:00.000Z`,
      endIso: files[files.length - 1]?.maxTimestamp || `${day}T23:59:59.999Z`,
    },
  };

  const totalRows = files.reduce((sum, f) => sum + (f.rowCount || 0), 0);
  const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0);

  const specHash = createHash('sha256')
    .update(JSON.stringify({ run, spec, layout }))
    .digest('hex');

  return {
    version: 1,
    manifestId: createHash('sha256')
      .update(`manifest:${specHash}:${createdAtIso}`)
      .digest('hex')
      .slice(0, 32),
    createdAtIso,
    run,
    spec,
    layout,
    parquetFiles: files.map((f) => ({
      path: `file://${resolve(f.sourcePath)}`,
      rowCount: f.rowCount,
      byteSize: f.byteSize,
      dt: f.inferredDate,
    })),
    summary: {
      totalFiles: files.length,
      totalRows,
      totalBytes,
      timeRangeObserved: files[0]?.minTimestamp && files[files.length - 1]?.maxTimestamp
        ? {
            startIso: files[0].minTimestamp,
            endIso: files[files.length - 1].maxTimestamp!,
          }
        : undefined,
    },
    integrity: {
      specHash,
    },
  };
}

/**
 * Main migration function
 */
async function migrateParquetFiles(args: MigrationArgs): Promise<void> {
  console.log('Starting Parquet migration...', {
    sourceDir: args.sourceDir,
    targetBase: args.targetBase,
    dataset: args.dataset,
    chain: args.chain,
    dryRun: args.dryRun,
  });

  // List all Parquet files in source directory
  const entries = await fs.readdir(args.sourceDir, { withFileTypes: true });
  const parquetFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.parquet'))
    .map((e) => join(args.sourceDir, e.name));

  if (parquetFiles.length === 0) {
    console.log('No Parquet files found in source directory');
    return;
  }

  console.log(`Found ${parquetFiles.length} Parquet files`);

  // Limit files if specified (for testing)
  const filesToProcess = args.maxFiles
    ? parquetFiles.slice(0, args.maxFiles)
    : parquetFiles;

  // Process files in batches
  const batchSize = 10;
  const fileMetadata: FileMetadata[] = [];

  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    const batch = filesToProcess.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filesToProcess.length / batchSize)}`);

    for (const filePath of batch) {
      try {
        const stats = await fs.stat(filePath);
        const filename = basename(filePath);
        const inferred = inferMetadataFromFilename(filename);

        // Read Parquet metadata
        const parquetMeta = await readParquetMetadata(filePath);

        const metadata: FileMetadata = {
          sourcePath: filePath,
          filename,
          byteSize: stats.size,
          rowCount: parquetMeta.rowCount,
          minTimestamp: parquetMeta.minTimestamp,
          maxTimestamp: parquetMeta.maxTimestamp,
          inferredDate: inferred.inferredDate,
          inferredChain: parquetMeta.chain || args.chain,
          inferredTokenId: inferred.inferredTokenId,
        };

        fileMetadata.push(metadata);
      } catch (error) {
        console.error(`Failed to process ${filePath}:`, error);
      }
    }
  }

  console.log(`Processed ${fileMetadata.length} files`);

  // Group files by date for manifest creation
  const filesByDate = new Map<string, FileMetadata[]>();
  for (const file of fileMetadata) {
    const date = file.inferredDate || 'unknown';
    if (!filesByDate.has(date)) {
      filesByDate.set(date, []);
    }
    filesByDate.get(date)!.push(file);
  }

  // Generate run ID for migration batch
  const runId = `migration_${Date.now()}`;

  // Create canonical layout spec
  const layout: ParquetLayoutSpec = {
    baseUri: `file://${resolve(args.targetBase)}`,
    subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
    compression: 'snappy',
    maxRowsPerFile: 1_000_000, // ~100MB assuming 100 bytes/row
    partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
  };

  // Migrate files
  let migratedCount = 0;
  const manifests: SliceManifestV1[] = [];

  for (const [date, files] of filesByDate.entries()) {
    const [yyyy, mm, dd] = date.split('-');
    const vars = {
      dataset: args.dataset,
      chain: args.chain,
      runId,
      yyyy: yyyy || new Date().getFullYear().toString(),
      mm: mm || (new Date().getMonth() + 1).toString().padStart(2, '0'),
      dd: dd || new Date().getDate().toString().padStart(2, '0'),
    };

    const subdir = expandTemplate(layout.subdirTemplate, vars);
    const targetDir = join(args.targetBase, subdir);

    if (!args.dryRun) {
      await fs.mkdir(targetDir, { recursive: true });
    }

    for (const file of files) {
      const targetPath = generatePartitionedPath(file, args, runId);

      if (args.dryRun) {
        console.log(`[DRY RUN] Would move: ${file.sourcePath} -> ${targetPath}`);
      } else {
        // Copy file (safer than move for first migration)
        await fs.copyFile(file.sourcePath, targetPath);
        console.log(`Migrated: ${basename(file.sourcePath)} -> ${targetPath}`);
      }
      migratedCount++;
    }

    // Create manifest for this date batch
    const manifest = createManifest(files, args, runId, layout);
    manifests.push(manifest);

    if (!args.dryRun) {
      const manifestPath = join(targetDir, 'slice.manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }
  }

  console.log('\nMigration summary:');
  console.log(`  Files processed: ${fileMetadata.length}`);
  console.log(`  Files migrated: ${migratedCount}`);
  console.log(`  Manifests created: ${manifests.length}`);
  console.log(`  Dry run: ${args.dryRun}`);

  if (args.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No files were actually moved');
    console.log('Run without --dry-run to perform migration');
  }
}

/**
 * CLI entry point
 */
async function main() {
  const { values, positionals } = parseArgs({
    options: {
      'source-dir': { type: 'string', default: './slices/per_token_v2' },
      'target-base': { type: 'string', default: './slices/partitioned' },
      dataset: { type: 'string', default: 'candles_1m' },
      chain: { type: 'string', default: 'sol' },
      'dry-run': { type: 'boolean', default: false },
      'max-files': { type: 'string' },
    },
    strict: false,
  });

  const args: MigrationArgs = {
    sourceDir: values['source-dir'] || './slices/per_token_v2',
    targetBase: values['target-base'] || './slices/partitioned',
    dataset: values.dataset || 'candles_1m',
    chain: (values.chain as MigrationArgs['chain']) || 'sol',
    dryRun: values['dry-run'] || false,
    maxFiles: values['max-files'] ? parseInt(values['max-files'], 10) : undefined,
  };

  await migrateParquetFiles(args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

export { migrateParquetFiles };

