/**
 * Unit tests for export-run-slices-lake handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportRunSlicesLakeHandler } from '../export-run-slices-lake.js';
import type { CommandContext } from '../../../core/command-context.js';
import type { ExportRunSlicesArgs } from '../../../commands/lake.js';

describe('exportRunSlicesLakeHandler', () => {
  let mockCtx: CommandContext;
  let mockLakeExporter: {
    exportRunSlices: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLakeExporter = {
      exportRunSlices: vi.fn(),
    };

    mockCtx = {
      services: {
        lakeExporter: () => mockLakeExporter as any,
      },
    } as unknown as CommandContext;
  });

  it('validates required options', async () => {
    const args: ExportRunSlicesArgs = {
      interval: '1s',
      window: 'pre52_post4948',
      alerts: 'inputs/alerts.parquet',
      dataRoot: 'data',
      chain: 'solana',
      compression: 'zstd',
      targetFileMb: 512,
      strictCoverage: false,
      minRequiredPre: 52,
      targetTotal: 5000,
      format: 'table',
    };

    const mockResult = {
      manifest_path: 'data/lake/runs/run_id=test/manifest.json',
      coverage_path: 'data/lake/runs/run_id=test/outputs/coverage.parquet',
      total_rows: 1000,
      total_files: 2,
      total_bytes: 1024000,
      manifest: {
        coverage: {
          kept_events: 95,
          dropped_events: 5,
        },
      },
    };

    vi.mocked(mockLakeExporter.exportRunSlices).mockResolvedValue(mockResult as any);

    const result = await exportRunSlicesLakeHandler(args, mockCtx);

    expect(mockLakeExporter.exportRunSlices).toHaveBeenCalledTimes(1);
    expect(result.total_rows).toBe(1000);
  });

  it('generates run_id if not provided', async () => {
    const args: ExportRunSlicesArgs = {
      interval: '1m',
      window: 'pre10_post20',
      alerts: 'alerts.parquet',
      format: 'table',
    };

    const mockResult = {
      manifest_path: 'data/lake/runs/run_id=test/manifest.json',
      coverage_path: 'data/lake/runs/run_id=test/outputs/coverage.parquet',
      total_rows: 100,
      total_files: 1,
      total_bytes: 50000,
      manifest: {
        coverage: {
          kept_events: 10,
          dropped_events: 0,
        },
      },
    };

    vi.mocked(mockLakeExporter.exportRunSlices).mockResolvedValue(mockResult as any);

    const result = await exportRunSlicesLakeHandler(args, mockCtx);

    expect(mockLakeExporter.exportRunSlices).toHaveBeenCalledTimes(1);
    const callConfig = vi.mocked(mockLakeExporter.exportRunSlices).mock.calls[0][0];
    expect(callConfig.run_id).toBeDefined();
    expect(result).toBeDefined();
  });

  it('invokes LakeExporterService with correct config', async () => {
    const args: ExportRunSlicesArgs = {
      runId: 'custom_run_123',
      interval: '1s',
      window: 'pre52_post4948',
      alerts: 'inputs/alerts.parquet',
      dataRoot: 'custom_data',
      chain: 'solana',
      compression: 'snappy',
      targetFileMb: 256,
      strictCoverage: true,
      minRequiredPre: 100,
      targetTotal: 6000,
      format: 'json',
    };

    const mockResult = {
      manifest_path: 'custom_data/lake/runs/run_id=custom_run_123/manifest.json',
      coverage_path: 'custom_data/lake/runs/run_id=custom_run_123/outputs/coverage.parquet',
      total_rows: 5000,
      total_files: 10,
      total_bytes: 2560000,
      manifest: {
        coverage: {
          kept_events: 80,
          dropped_events: 20,
        },
      },
    };

    vi.mocked(mockLakeExporter.exportRunSlices).mockResolvedValue(mockResult as any);

    await exportRunSlicesLakeHandler(args, mockCtx);

    expect(mockLakeExporter.exportRunSlices).toHaveBeenCalledTimes(1);
    const callConfig = vi.mocked(mockLakeExporter.exportRunSlices).mock.calls[0][0];
    expect(callConfig.run_id).toBe('custom_run_123');
    expect(callConfig.interval).toBe('1s');
    expect(callConfig.window).toBe('pre52_post4948');
    expect(callConfig.alerts_path).toBe('inputs/alerts.parquet');
    expect(callConfig.data_root).toBe('custom_data');
    expect(callConfig.compression).toBe('snappy');
    expect(callConfig.strict_coverage).toBe(true);
    expect(callConfig.min_required_pre).toBe(100);
    expect(callConfig.target_total).toBe(6000);
    expect(callConfig.clickhouse).toBeDefined();
  });
});

