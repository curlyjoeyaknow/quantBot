/**
 * Export Run Slices Lake Handler
 *
 * Handler for exporting run-scoped slices to Parquet Lake v1 format.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { ExportRunSlicesArgs } from '../../commands/lake.js';
import { generateRunId } from '../../core/run-id-manager.js';
import { DateTime } from 'luxon';

export async function exportRunSlicesLakeHandler(args: ExportRunSlicesArgs, ctx: CommandContext) {
  // Generate run_id if not provided
  const runId =
    args.runId ||
    generateRunId({
      command: 'lake-export',
      strategyId: 'lake',
      mint: 'all',
      alertTimestamp: DateTime.now().toISO() || '',
    });

  // Get ClickHouse config from environment
  const chHost = process.env.CLICKHOUSE_HOST || 'localhost';
  // Prefer CLICKHOUSE_HTTP_PORT (explicit HTTP) over CLICKHOUSE_PORT (may be native TCP)
  const chPort = parseInt(
    process.env.CLICKHOUSE_HTTP_PORT || process.env.CLICKHOUSE_PORT || '18123',
    10
  );
  const chDatabase = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const chUser = process.env.CLICKHOUSE_USER || 'default';
  const chPassword = process.env.CLICKHOUSE_PASSWORD || '';

  // Get lake exporter service
  const lakeExporter = ctx.services.lakeExporter();

  // Build config
  const config = {
    data_root: args.dataRoot,
    run_id: runId,
    interval: args.interval,
    window: args.window,
    alerts_path: args.alerts,
    chain: args.chain,
    compression: args.compression,
    target_file_mb: args.targetFileMb,
    strict_coverage: args.strictCoverage,
    min_required_pre: args.minRequiredPre,
    target_total: args.targetTotal,
    clickhouse: {
      host: chHost,
      port: chPort,
      database: chDatabase,
      table: 'ohlcv_candles',
      user: chUser,
      password: chPassword,
      connect_timeout: 10,
      send_receive_timeout: 300,
    },
  };

  // Call service
  const result = await lakeExporter.exportRunSlices(config);

  return {
    run_id: runId,
    manifest_path: result.manifest_path,
    coverage_path: result.coverage_path,
    total_rows: result.total_rows,
    total_files: result.total_files,
    total_bytes: result.total_bytes,
    coverage: result.manifest.coverage,
  };
}
