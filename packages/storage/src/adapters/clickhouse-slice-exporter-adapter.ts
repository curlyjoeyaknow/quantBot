import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { getClickHouseClient } from '../clickhouse-client.js';
import { logger } from '@quantbot/utils';
import { readAllBytes } from '../utils/readAllBytes.js';
import type {
  SliceExporterPort,
  SliceExportSpec,
  SliceExportResult,
  SliceManifest,
  ParquetFileMetadata,
} from '@quantbot/core';

/**
 * ClickHouse Slice Exporter Adapter
 *
 * This adapter does the "dirty work":
 * - Executes ClickHouse queries
 * - Writes Parquet files
 * - Handles partitioning, compression, file naming
 * - Generates manifest
 * - Handles retries, errors, etc.
 */
export class ClickHouseSliceExporterAdapter implements SliceExporterPort {
  /**
   * Export a data slice from ClickHouse to Parquet
   */
  async exportSlice(spec: SliceExportSpec): Promise<SliceExportResult> {
    try {
      // Ensure output directory exists
      await fs.mkdir(spec.output.basePath, { recursive: true });

      const parquetFiles: ParquetFileMetadata[] = [];
      const rowCounts: Record<string, number> = {};
      const client = getClickHouseClient();

      // Export each table
      for (const tableSpec of spec.tables) {
        const tableResult = await this.exportTable(client, tableSpec, spec, spec.output.basePath);

        parquetFiles.push(...tableResult.files);
        rowCounts[tableSpec.tableName] = tableResult.totalRows;
      }

      // Generate manifest
      const manifest: SliceManifest = {
        exportId: spec.exportId,
        spec,
        exportedAt: new Date().toISOString(),
        parquetFiles,
        rowCounts,
        schemaVersion: '1.0.0',
        checksum: this.computeChecksum(parquetFiles),
        metadata: {
          totalFiles: parquetFiles.length,
          totalRows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
        },
      };

      // Write manifest to disk
      const manifestPath = join(spec.output.basePath, 'slice.manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      logger.info('Slice export completed', {
        exportId: spec.exportId,
        parquetFiles: parquetFiles.length,
        totalRows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
      });

      return {
        success: true,
        manifest,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Slice export failed', { exportId: spec.exportId, error: message });

      return {
        success: false,
        manifest: {
          exportId: spec.exportId,
          spec,
          exportedAt: new Date().toISOString(),
          parquetFiles: [],
          rowCounts: {},
          schemaVersion: '1.0.0',
        },
        error: message,
      };
    }
  }

  /**
   * Export a single table
   */
  private async exportTable(
    client: ReturnType<typeof getClickHouseClient>,
    tableSpec: SliceExportSpec['tables'][0],
    spec: SliceExportSpec,
    basePath: string
  ): Promise<{ files: ParquetFileMetadata[]; totalRows: number }> {
    // Build ClickHouse query
    const columns = tableSpec.columns || ['*'];
    const columnList = columns.join(', ');

    // Build WHERE clause
    const whereConditions: string[] = [];

    if (spec.timeRange) {
      whereConditions.push(
        `timestamp >= '${spec.timeRange.from}' AND timestamp < '${spec.timeRange.to}'`
      );
    }

    if (spec.tokenAddresses && spec.tokenAddresses.length > 0) {
      const tokenList = spec.tokenAddresses.map((t: string) => `'${t}'`).join(', ');
      whereConditions.push(`token_address IN (${tokenList})`);
    }

    if (spec.chain) {
      whereConditions.push(`chain = '${spec.chain}'`);
    }

    // Add custom filters
    if (tableSpec.filters) {
      for (const [key, value] of Object.entries(tableSpec.filters)) {
        if (typeof value === 'string') {
          whereConditions.push(`${key} = '${value}'`);
        } else {
          whereConditions.push(`${key} = ${value}`);
        }
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Query ClickHouse
    const query = `SELECT ${columnList} FROM ${tableSpec.tableName} ${whereClause} FORMAT Parquet`;

    logger.info('Executing ClickHouse query', {
      table: tableSpec.tableName,
      query: query.substring(0, 200) + '...',
    });

    const result = await client.query({
      query,
      format: 'Parquet',
    });

    // Read Parquet data from stream
    // ClickHouse client returns a stream that can be read as async iterable or Web ReadableStream
    // result.stream may be a function that returns the actual stream
    let parquetData: Buffer;
    try {
      // Fix call site: handle result.stream as function or property
       
      const streamSource =
        typeof (result as any).stream === 'function'
          ? await (result as any).stream()
          : ((result as any).stream ?? (result as any).body ?? result);

      const streamBytes = await readAllBytes(streamSource);
      parquetData = Buffer.from(streamBytes);
    } catch (error: unknown) {
      logger.error('Failed to read Parquet stream from ClickHouse', {
        error: error instanceof Error ? error.message : String(error),
        table: tableSpec.tableName,
      });
      throw new Error(
        `Failed to read Parquet stream: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Determine output path
    const fileName = `${tableSpec.tableName}_${spec.exportId}.parquet`;
    const outputPath = join(basePath, fileName);

    // Ensure directory exists
    await fs.mkdir(dirname(outputPath), { recursive: true });

    // Write Parquet file
    await fs.writeFile(outputPath, parquetData);

    // Get file stats
    const stats = await fs.stat(outputPath);

    // For now, we'll need to query row count separately
    // (ClickHouse Parquet format doesn't include row count in metadata)
    const countResult = await client.query({
      query: `SELECT count(*) as cnt FROM ${tableSpec.tableName} ${whereClause}`,
      format: 'JSONEachRow',
    });

    const countData = (await countResult.json()) as Array<{ cnt: string }>;
    const rowCount = countData.length > 0 ? parseInt(countData[0].cnt || '0', 10) : 0;

    const fileMetadata: ParquetFileMetadata = {
      path: fileName,
      absolutePath: outputPath,
      rowCount: Number(rowCount),
      sizeBytes: stats.size,
      schemaVersion: '1.0.0',
    };

    return {
      files: [fileMetadata],
      totalRows: Number(rowCount),
    };
  }

  /**
   * Compute checksum for manifest integrity
   */
  private computeChecksum(files: ParquetFileMetadata[]): string {
    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(file.path);
      hash.update(String(file.rowCount));
      hash.update(String(file.sizeBytes));
    }
    return hash.digest('hex');
  }
}

/**
 * Create ClickHouse slice exporter adapter
 */
export function createClickHouseSliceExporterAdapter(): SliceExporterPort {
  return new ClickHouseSliceExporterAdapter();
}
