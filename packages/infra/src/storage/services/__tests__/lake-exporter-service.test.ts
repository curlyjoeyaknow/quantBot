/**
 * Unit tests for LakeExporterService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LakeExporterService } from '../lake-exporter-service.js';
import type { PythonEngine } from '@quantbot/infra/utils';
import type { LakeRunSliceExportConfig, LakeExportResult } from '../lake-exporter-service.js';

describe('LakeExporterService', () => {
  let mockPythonEngine: PythonEngine;
  let service: LakeExporterService;

  beforeEach(() => {
    mockPythonEngine = {
      runScriptWithStdin: vi.fn(),
    } as unknown as PythonEngine;

    service = new LakeExporterService(mockPythonEngine);
  });

  it('passes correct config JSON to Python', async () => {
    const config: LakeRunSliceExportConfig = {
      data_root: 'data',
      run_id: 'test_run_123',
      interval: '1s',
      window: 'pre52_post4948',
      alerts_path: 'inputs/alerts.parquet',
      chain: 'solana',
      compression: 'zstd',
      target_file_mb: 512,
      strict_coverage: false,
      min_required_pre: 52,
      target_total: 5000,
      clickhouse: {
        host: 'localhost',
        port: 8123,
        database: 'quantbot',
        table: 'ohlcv_candles',
        user: 'default',
        password: '',
        connect_timeout: 10,
        send_receive_timeout: 300,
      },
    };

    const mockResult: LakeExportResult = {
      manifest: {
        lake_version: 'v1',
        run_id: 'test_run_123',
        created_at: '2024-01-01T00:00:00Z',
        exporter: {
          name: 'slice_exporter',
          version: '1.0.0',
        },
        inputs: {
          alerts: {
            path: 'inputs/alerts.parquet',
            sha256: 'abc123',
            rows: 100,
          },
          source_snapshot: {
            clickhouse: {
              cluster: 'localhost',
              database: 'quantbot',
              table: 'ohlcv_candles',
              as_of: '2024-01-01T00:00:00Z',
            },
          },
        },
        slice_spec: {
          dataset: 'ohlcv',
          interval: '1s',
          window: 'pre52_post4948',
          anchor_rule: 'floor_to_interval(ts, interval)',
        },
        outputs: {
          'slices/ohlcv/interval=1s/window=pre52_post4948': {
            mint_buckets: ['00', '01'],
            files: 2,
            rows: 1000,
          },
        },
        coverage: {
          min_required_pre: 52,
          target_total: 5000,
          kept_events: 95,
          dropped_events: 5,
        },
      },
      manifest_path: 'data/lake/runs/run_id=test_run_123/manifest.json',
      coverage_path: 'data/lake/runs/run_id=test_run_123/outputs/coverage.parquet',
      total_rows: 1000,
      total_files: 2,
      total_bytes: 1024000,
    };

    vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockResult);

    const result = await service.exportRunSlices(config);

    // Verify Python was called with correct config
    expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(mockPythonEngine.runScriptWithStdin).mock.calls[0];
    expect(callArgs[0]).toContain('export_lake_run_slices.py');
    expect(callArgs[1]).toEqual(config);
    expect(callArgs[2]).toBeDefined(); // Zod schema

    // Verify result
    expect(result).toEqual(mockResult);
    expect(result.total_rows).toBe(1000);
    expect(result.total_files).toBe(2);
  });

  it('parses Python result with Zod validation', async () => {
    const config: LakeRunSliceExportConfig = {
      data_root: 'data',
      run_id: 'test_run',
      interval: '1m',
      window: 'pre10_post20',
      alerts_path: 'alerts.parquet',
      clickhouse: {
        host: 'localhost',
        port: 8123,
        database: 'quantbot',
        table: 'ohlcv_candles',
        user: 'default',
      },
    };

    const mockResult = {
      manifest: {
        lake_version: 'v1',
        run_id: 'test_run',
        created_at: '2024-01-01T00:00:00Z',
        exporter: { name: 'slice_exporter', version: '1.0.0' },
        inputs: {
          alerts: { path: 'inputs/alerts.parquet', sha256: 'abc', rows: 10 },
          source_snapshot: {
            clickhouse: {
              cluster: 'localhost',
              database: 'quantbot',
              table: 'ohlcv_candles',
              as_of: '2024-01-01T00:00:00Z',
            },
          },
        },
        slice_spec: {
          dataset: 'ohlcv',
          interval: '1m',
          window: 'pre10_post20',
          anchor_rule: 'floor_to_interval(ts, interval)',
        },
        outputs: {
          'slices/ohlcv/interval=1m/window=pre10_post20': {
            mint_buckets: ['00'],
            files: 1,
            rows: 100,
          },
        },
        coverage: { min_required_pre: 10, target_total: 30, kept_events: 8, dropped_events: 2 },
      },
      manifest_path: 'data/lake/runs/run_id=test_run/manifest.json',
      coverage_path: 'data/lake/runs/run_id=test_run/outputs/coverage.parquet',
      total_rows: 100,
      total_files: 1,
      total_bytes: 50000,
    };

    vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(
      mockResult as LakeExportResult
    );

    const result = await service.exportRunSlices(config);

    expect(result).toBeDefined();
    expect(result.manifest.run_id).toBe('test_run');
  });

  it('handles Python script errors gracefully', async () => {
    const config: LakeRunSliceExportConfig = {
      data_root: 'data',
      run_id: 'test_run',
      interval: '1m',
      window: 'pre10_post20',
      alerts_path: 'alerts.parquet',
      clickhouse: {
        host: 'localhost',
        port: 8123,
        database: 'quantbot',
        table: 'ohlcv_candles',
        user: 'default',
      },
    };

    const error = new Error('Python script failed');
    vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValue(error);

    await expect(service.exportRunSlices(config)).rejects.toThrow('Python script failed');
  });
});
