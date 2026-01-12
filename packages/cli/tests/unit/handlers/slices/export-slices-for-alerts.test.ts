/**
 * Unit tests for export-slices-for-alerts handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSlicesForAlertsHandler } from '../../../../src/handlers/slices/export-slices-for-alerts.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { exportSlicesForAlerts } from '@quantbot/workflows';
import { createQueryCallsDuckdbContext } from '@quantbot/workflows';

// Mock dependencies
vi.mock('@quantbot/workflows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/workflows')>();
  return {
    ...actual,
    exportSlicesForAlerts: vi.fn(),
    createQueryCallsDuckdbContext: vi.fn(),
  };
});

vi.mock('@quantbot/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/storage')>();
  class MockClickHouseSliceExporterAdapterImpl {
    exportSlice = vi.fn();
  }
  return {
    ...actual,
    ClickHouseSliceExporterAdapterImpl: MockClickHouseSliceExporterAdapterImpl,
  };
});

vi.mock('@quantbot/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/utils')>();
  return {
    ...actual,
    getDuckDBPath: vi.fn(() => '/tmp/test.duckdb'),
  };
});

describe('exportSlicesForAlertsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createQueryCallsDuckdbContext).mockResolvedValue({
      repos: {} as any,
      clock: { nowISO: () => new Date().toISOString() },
      ids: { newRunId: () => 'test-run-id' },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as any);
    vi.mocked(exportSlicesForAlerts).mockResolvedValue({
      success: true,
      runId: 'test-run-id',
      totalAlerts: 5,
      processedAlerts: 5,
      successfulExports: 5,
      failedExports: 0,
      exports: [],
      summary: {
        totalFiles: 5,
        totalRows: 100,
        totalBytes: 1000,
      },
    });
  });

  it('should call exportSlicesForAlerts workflow with correct parameters', async () => {
    const mockCtx = {} as unknown as CommandContext;

    const args = {
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      dataset: 'candles_5m' as const,
      chain: 'sol' as const,
      catalogPath: './catalog',
      preWindow: 260,
      postWindow: 1440,
      useDatePartitioning: false,
      maxHoursPerChunk: 6,
    };

    const result = await exportSlicesForAlertsHandler(args, mockCtx);

    // Handler calls exportSlicesForAlerts workflow function directly
    expect(exportSlicesForAlerts).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.runId).toBe('test-run-id');
    expect(result.successfulExports).toBe(5);
  });
});
