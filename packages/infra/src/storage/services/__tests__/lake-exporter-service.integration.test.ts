/**
 * Integration tests for LakeExporterService
 *
 * Tests the full pipeline: Service → PythonEngine → Python script → Parquet output
 * Uses mocked PythonEngine to avoid requiring actual ClickHouse connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LakeExporterService } from '../lake-exporter-service.js';
import type { PythonEngine } from '@quantbot/infra/utils';
import type { LakeRunSliceExportConfig, LakeExportResult } from '../lake-exporter-service.js';

describe('LakeExporterService Integration', () => {
  let mockPythonEngine: PythonEngine;
  let service: LakeExporterService;

  beforeEach(() => {
    mockPythonEngine = {
      runScriptWithStdin: vi.fn(),
    } as unknown as PythonEngine;

    service = new LakeExporterService(mockPythonEngine);
  });

  it('full pipeline: config → Python → result', async () => {
    const config: LakeRunSliceExportConfig = {
      data_root: 'data',
      run_id: 'integration_test_run',
      interval: '1m',
      window: 'pre10_post20',
      alerts_path: 'test/alerts.parquet',
      chain: 'solana',
      compression: 'zstd',
      target_file_mb: 512,
      strict_coverage: false,
      min_required_pre: 10,
      target_total: 30,
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

    const mockPythonResult: LakeExportResult = {
      manifest: {
        lake_version: 'v1',
        run_id: 'integration_test_run',
        created_at: '2024-01-01T00:00:00Z',
        exporter: {
          name: 'slice_exporter',
          version: '1.0.0',
        },
        inputs: {
          alerts: {
            path: 'inputs/alerts.parquet',
            sha256: 'abc123def456',
            rows: 10,
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
          interval: '1m',
          window: 'pre10_post20',
          anchor_rule: 'floor_to_interval(ts, interval)',
        },
        outputs: {
          'slices/ohlcv/interval=1m/window=pre10_post20': {
            mint_buckets: ['00', '01', '02'],
            files: 3,
            rows: 1000,
          },
        },
        coverage: {
          min_required_pre: 10,
          target_total: 30,
          kept_events: 8,
          dropped_events: 2,
        },
      },
      manifest_path: 'data/lake/runs/run_id=integration_test_run/manifest.json',
      coverage_path: 'data/lake/runs/run_id=integration_test_run/outputs/coverage.parquet',
      total_rows: 1000,
      total_files: 3,
      total_bytes: 1024000,
    };

    vi.mocked(mockPythonEngine.runScriptWithStdin).mockResolvedValue(mockPythonResult);

    const result = await service.exportRunSlices(config);

    // Verify Python was called correctly
    expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(mockPythonEngine.runScriptWithStdin).mock.calls[0];

    // Verify script path
    expect(callArgs[0]).toContain('export_lake_run_slices.py');

    // Verify config passed correctly
    const passedConfig = callArgs[1] as LakeRunSliceExportConfig;
    expect(passedConfig.run_id).toBe('integration_test_run');
    expect(passedConfig.interval).toBe('1m');
    expect(passedConfig.window).toBe('pre10_post20');
    expect(passedConfig.alerts_path).toBe('test/alerts.parquet');
    expect(passedConfig.clickhouse.host).toBe('localhost');
    expect(passedConfig.clickhouse.database).toBe('quantbot');

    // Verify result structure
    expect(result).toEqual(mockPythonResult);
    expect(result.manifest.run_id).toBe('integration_test_run');
    expect(result.total_rows).toBe(1000);
    expect(result.total_files).toBe(3);
    expect(result.manifest.coverage.kept_events).toBe(8);
    expect(result.manifest.coverage.dropped_events).toBe(2);
  });

  it('handles Python script errors with proper error propagation', async () => {
    const config: LakeRunSliceExportConfig = {
      data_root: 'data',
      run_id: 'error_test',
      interval: '1m',
      window: 'pre10_post20',
      alerts_path: 'test/alerts.parquet',
      clickhouse: {
        host: 'localhost',
        port: 8123,
        database: 'quantbot',
        table: 'ohlcv_candles',
        user: 'default',
      },
    };

    const error = new Error('Python script execution failed: ClickHouse connection timeout');
    vi.mocked(mockPythonEngine.runScriptWithStdin).mockRejectedValue(error);

    await expect(service.exportRunSlices(config)).rejects.toThrow('Python script execution failed');

    // Verify PythonEngine was called
    expect(mockPythonEngine.runScriptWithStdin).toHaveBeenCalledTimes(1);
  });

  it('validates config schema before calling Python', async () => {
    const invalidConfig = {
      data_root: 'data',
      // Missing required fields: run_id, interval, window, alerts_path
      clickhouse: {
        host: 'localhost',
        port: 8123,
        database: 'quantbot',
        table: 'ohlcv_candles',
        user: 'default',
      },
    } as unknown as LakeRunSliceExportConfig;

    // Should fail validation before calling Python
    await expect(service.exportRunSlices(invalidConfig)).rejects.toThrow();

    // PythonEngine should not be called if validation fails
    expect(mockPythonEngine.runScriptWithStdin).not.toHaveBeenCalled();
  });
});
