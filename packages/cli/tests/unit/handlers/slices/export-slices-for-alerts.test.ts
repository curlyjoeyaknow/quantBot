/**
 * Export Slices for Alerts Handler Tests
 *
 * Tests for the exportSlicesForAlertsHandler function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSlicesForAlertsHandler } from '../../../../src/handlers/slices/export-slices-for-alerts.js';
import type { ExportSlicesForAlertsArgs } from '../../../../src/handlers/slices/export-slices-for-alerts.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { exportSlicesForAlerts } from '@quantbot/workflows';
import { createQueryCallsDuckdbContext } from '@quantbot/workflows';
import { ClickHouseSliceExporterAdapterImpl } from '@quantbot/storage';

vi.mock('@quantbot/workflows', () => ({
  exportSlicesForAlerts: vi.fn(),
  createQueryCallsDuckdbContext: vi.fn(),
}));

vi.mock('@quantbot/storage', () => ({
  ClickHouseSliceExporterAdapterImpl: class {
    // Mock implementation
  },
}));

vi.mock('@quantbot/utils', () => ({
  getDuckDBPath: vi.fn(() => 'data/tele.duckdb'),
}));

describe('exportSlicesForAlertsHandler', () => {
  let mockCtx: CommandContext;
  let mockWorkflowResult: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {} as CommandContext;

    mockWorkflowResult = {
      success: true,
      runId: 'test-run-id',
      totalAlerts: 1,
      successfulExports: 1,
      failedExports: 0,
      exports: [],
      summary: {
        totalFiles: 1,
        totalRows: 100,
        totalBytes: 1000,
      },
    };

    vi.mocked(exportSlicesForAlerts).mockResolvedValue(mockWorkflowResult);
    vi.mocked(createQueryCallsDuckdbContext).mockResolvedValue({
      clock: { nowISO: () => new Date().toISOString() },
      ids: { newRunId: () => 'test-run' },
      queryCalls: vi.fn(),
    } as any);
  });

  describe('Basic functionality', () => {
    it('should call workflow with correct parameters', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        catalogPath: './catalog',
        dataset: 'candles_1m',
        chain: 'sol',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      expect(createQueryCallsDuckdbContext).toHaveBeenCalledWith('data/tele.duckdb');
      expect(exportSlicesForAlerts).toHaveBeenCalled();

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.fromISO).toBe('2025-01-15T00:00:00Z');
      expect(spec.toISO).toBe('2025-01-16T00:00:00Z');
      expect(spec.catalogBasePath).toBe('./catalog');
      expect(spec.dataset).toBe('candles_1m');
      expect(spec.chain).toBe('sol');
    });

    it('should return workflow result', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
      };

      const result = await exportSlicesForAlertsHandler(args, mockCtx);

      expect(result).toEqual(mockWorkflowResult);
    });
  });

  describe('Phase 4: Dataset Support', () => {
    it('should support candles_5m dataset', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        dataset: 'candles_5m',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.dataset).toBe('candles_5m');
    });

    it('should support indicators_1m dataset', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        dataset: 'indicators_1m',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.dataset).toBe('indicators_1m');
    });
  });

  describe('Phase 6: Performance Features', () => {
    it('should pass date partitioning flag when enabled', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        useDatePartitioning: true,
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.useDatePartitioning).toBe(true);
    });

    it('should pass maxRowsPerFile when specified', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        maxRowsPerFile: 100000,
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.maxRowsPerFile).toBe(100000);
    });

    it('should pass maxHoursPerChunk when specified', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        maxHoursPerChunk: 12,
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.maxHoursPerChunk).toBe(12);
    });

    it('should use default maxHoursPerChunk when not specified', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.maxHoursPerChunk).toBe(6); // Default value
    });
  });

  describe('Parameter handling', () => {
    it('should handle optional caller filter', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        caller: 'Brook',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.callerName).toBe('Brook');
    });

    it('should handle optional preWindow and postWindow', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        preWindow: 120,
        postWindow: 720,
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.preWindowMinutes).toBe(120);
      expect(spec.postWindowMinutes).toBe(720);
    });

    it('should use default catalog path when not specified', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      const workflowCall = vi.mocked(exportSlicesForAlerts).mock.calls[0];
      const spec = workflowCall[0];

      expect(spec.catalogBasePath).toBe('./catalog');
    });

    it('should use custom DuckDB path when specified', async () => {
      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
        duckdb: 'custom/path.duckdb',
      };

      await exportSlicesForAlertsHandler(args, mockCtx);

      expect(createQueryCallsDuckdbContext).toHaveBeenCalledWith('custom/path.duckdb');
    });
  });

  describe('Error propagation', () => {
    it('should propagate workflow errors', async () => {
      const error = new Error('Workflow failed');
      vi.mocked(exportSlicesForAlerts).mockRejectedValue(error);

      const args: ExportSlicesForAlertsArgs = {
        from: '2025-01-15T00:00:00Z',
        to: '2025-01-16T00:00:00Z',
      };

      await expect(exportSlicesForAlertsHandler(args, mockCtx)).rejects.toThrow('Workflow failed');
    });
  });
});
