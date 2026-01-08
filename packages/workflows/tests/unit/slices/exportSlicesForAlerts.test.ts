/**
 * Export Slices for Alerts Unit Tests
 *
 * Tests for the exportSlicesForAlerts workflow function.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { exportSlicesForAlerts } from '../../../src/slices/exportSlicesForAlerts.js';
import type {
  ExportSlicesForAlertsSpec,
  ExportSlicesForAlertsContext,
} from '../../../src/slices/exportSlicesForAlerts.js';
import type { SliceExporter, SliceManifestV1 } from '@quantbot/core';
import { queryCallsDuckdb } from '../../../src/calls/queryCallsDuckdb.js';

// Mock queryCallsDuckdb
vi.mock('../../../src/calls/queryCallsDuckdb.js', () => ({
  queryCallsDuckdb: vi.fn(),
}));

describe('exportSlicesForAlerts', () => {
  let mockExporter: SliceExporter;
  let mockContext: ExportSlicesForAlertsContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock exporter
    mockExporter = {
      exportSlice: vi.fn(),
    };

    // Mock context
    mockContext = {
      clock: {
        nowISO: () => new Date().toISOString(),
      },
      ids: {
        newRunId: () => 'test-run-id',
      },
      exporter: mockExporter,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as any;

    // Mock queryCallsDuckdb
    vi.mocked(queryCallsDuckdb).mockResolvedValue({
      calls: [],
    } as any);
  });

  describe('Date-based Partitioning', () => {
    it('should use date-based partitioning when enabled', async () => {
      const mockManifest: SliceManifestV1 = {
        version: 1,
        manifestId: 'test-manifest',
        createdAtIso: new Date().toISOString(),
        run: {
          runId: 'test-run',
          createdAtIso: new Date().toISOString(),
        },
        spec: {
          dataset: 'candles_1m',
          chain: 'sol',
          timeRange: {
            startIso: '2025-01-15T00:00:00Z',
            endIso: '2025-01-15T23:59:59Z',
          },
        },
        layout: {
          baseUri: 'file://./catalog',
          subdirTemplate: 'data/bars/{yyyy}-{mm}-{dd}',
        },
        parquetFiles: [],
        summary: {
          totalFiles: 0,
          totalRows: 0,
          totalBytes: 0,
        },
      };

      vi.mocked(mockExporter.exportSlice).mockResolvedValue(mockManifest);
      vi.mocked(queryCallsDuckdb).mockResolvedValue({
        calls: [
          {
            id: 'call-1',
            mint: 'So11111111111111111111111111111111111111112',
            createdAt: DateTime.fromISO('2025-01-15T12:00:00Z'),
          },
        ],
      } as any);

      const spec: ExportSlicesForAlertsSpec = {
        fromISO: '2025-01-15T00:00:00Z',
        toISO: '2025-01-16T00:00:00Z',
        catalogBasePath: './catalog',
        useDatePartitioning: true,
        dataset: 'candles_1m',
        chain: 'sol',
      };

      await exportSlicesForAlerts(spec, mockContext);

      // Verify exporter was called with date-based subdirTemplate
      expect(mockExporter.exportSlice).toHaveBeenCalled();
      const callArgs = vi.mocked(mockExporter.exportSlice).mock.calls[0]?.[0];
      expect(callArgs?.layout.subdirTemplate).toContain('{yyyy}-{mm}-{dd}');
    });
  });

  describe('Day Chunking', () => {
    it('should chunk large time windows when maxHoursPerChunk is exceeded', async () => {
      const mockManifest: SliceManifestV1 = {
        version: 1,
        manifestId: 'test-manifest',
        createdAtIso: new Date().toISOString(),
        run: {
          runId: 'test-run',
          createdAtIso: new Date().toISOString(),
        },
        spec: {
          dataset: 'candles_1m',
          chain: 'sol',
          timeRange: {
            startIso: '2025-01-15T00:00:00Z',
            endIso: '2025-01-15T06:00:00Z',
          },
        },
        layout: {
          baseUri: 'file://./catalog',
          subdirTemplate: 'data/bars',
        },
        parquetFiles: [],
        summary: {
          totalFiles: 0,
          totalRows: 0,
          totalBytes: 0,
        },
      };

      vi.mocked(mockExporter.exportSlice).mockResolvedValue(mockManifest);
      vi.mocked(queryCallsDuckdb).mockResolvedValue({
        calls: [
          {
            id: 'call-1',
            mint: 'So11111111111111111111111111111111111111112',
            createdAt: DateTime.fromISO('2025-01-15T12:00:00Z'),
          },
        ],
      } as any);

      const spec: ExportSlicesForAlertsSpec = {
        fromISO: '2025-01-15T00:00:00Z',
        toISO: '2025-01-16T00:00:00Z',
        catalogBasePath: './catalog',
        preWindowMinutes: 0,
        postWindowMinutes: 1440, // 24 hours
        maxHoursPerChunk: 6, // Should create 4 chunks (24 hours / 6 hours)
        dataset: 'candles_1m',
        chain: 'sol',
      };

      await exportSlicesForAlerts(spec, mockContext);

      // Should be called multiple times for chunking
      expect(mockExporter.exportSlice).toHaveBeenCalled();
      const callCount = vi.mocked(mockExporter.exportSlice).mock.calls.length;
      expect(callCount).toBeGreaterThan(1); // Multiple chunks
    });

    it('should not chunk when time window is within maxHoursPerChunk', async () => {
      const mockManifest: SliceManifestV1 = {
        version: 1,
        manifestId: 'test-manifest',
        createdAtIso: new Date().toISOString(),
        run: {
          runId: 'test-run',
          createdAtIso: new Date().toISOString(),
        },
        spec: {
          dataset: 'candles_1m',
          chain: 'sol',
          timeRange: {
            startIso: '2025-01-15T00:00:00Z',
            endIso: '2025-01-15T05:00:00Z',
          },
        },
        layout: {
          baseUri: 'file://./catalog',
          subdirTemplate: 'data/bars',
        },
        parquetFiles: [],
        summary: {
          totalFiles: 0,
          totalRows: 0,
          totalBytes: 0,
        },
      };

      vi.mocked(mockExporter.exportSlice).mockResolvedValue(mockManifest);
      vi.mocked(queryCallsDuckdb).mockResolvedValue({
        calls: [
          {
            id: 'call-1',
            mint: 'So11111111111111111111111111111111111111112',
            createdAt: DateTime.fromISO('2025-01-15T12:00:00Z'),
          },
        ],
      } as any);

      const spec: ExportSlicesForAlertsSpec = {
        fromISO: '2025-01-15T00:00:00Z',
        toISO: '2025-01-16T00:00:00Z',
        catalogBasePath: './catalog',
        preWindowMinutes: 0,
        postWindowMinutes: 300, // 5 hours (less than maxHoursPerChunk of 6)
        maxHoursPerChunk: 6,
        dataset: 'candles_1m',
        chain: 'sol',
      };

      await exportSlicesForAlerts(spec, mockContext);

      // Should be called once (no chunking needed)
      expect(mockExporter.exportSlice).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dataset Support', () => {
    it('should support candles_5m dataset', async () => {
      const mockManifest: SliceManifestV1 = {
        version: 1,
        manifestId: 'test-manifest',
        createdAtIso: new Date().toISOString(),
        run: {
          runId: 'test-run',
          createdAtIso: new Date().toISOString(),
        },
        spec: {
          dataset: 'candles_5m',
          chain: 'sol',
          timeRange: {
            startIso: '2025-01-15T00:00:00Z',
            endIso: '2025-01-15T23:59:59Z',
          },
        },
        layout: {
          baseUri: 'file://./catalog',
          subdirTemplate: 'data/bars',
        },
        parquetFiles: [],
        summary: {
          totalFiles: 0,
          totalRows: 0,
          totalBytes: 0,
        },
      };

      vi.mocked(mockExporter.exportSlice).mockResolvedValue(mockManifest);
      vi.mocked(queryCallsDuckdb).mockResolvedValue({
        calls: [
          {
            id: 'call-1',
            mint: 'So11111111111111111111111111111111111111112',
            createdAt: DateTime.fromISO('2025-01-15T12:00:00Z'),
          },
        ],
      } as any);

      const spec: ExportSlicesForAlertsSpec = {
        fromISO: '2025-01-15T00:00:00Z',
        toISO: '2025-01-16T00:00:00Z',
        catalogBasePath: './catalog',
        dataset: 'candles_5m',
        chain: 'sol',
      };

      const result = await exportSlicesForAlerts(spec, mockContext);

      expect(result.success).toBe(true);
      expect(mockExporter.exportSlice).toHaveBeenCalled();
      const callArgs = vi.mocked(mockExporter.exportSlice).mock.calls[0]?.[0];
      expect(callArgs?.spec.dataset).toBe('candles_5m');
    });
  });

  describe('Empty Results', () => {
    it('should handle empty call results gracefully', async () => {
      vi.mocked(queryCallsDuckdb).mockResolvedValue({
        calls: [],
      } as any);

      const spec: ExportSlicesForAlertsSpec = {
        fromISO: '2025-01-15T00:00:00Z',
        toISO: '2025-01-16T00:00:00Z',
        catalogBasePath: './catalog',
        dataset: 'candles_1m',
        chain: 'sol',
      };

      const result = await exportSlicesForAlerts(spec, mockContext);

      expect(result.success).toBe(true);
      expect(result.totalAlerts).toBe(0);
      expect(result.successfulExports).toBe(0);
      expect(result.failedExports).toBe(0);
      expect(mockExporter.exportSlice).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle exporter errors gracefully', async () => {
      vi.mocked(mockExporter.exportSlice).mockRejectedValue(new Error('Export failed'));
      vi.mocked(queryCallsDuckdb).mockResolvedValue({
        calls: [
          {
            id: 'call-1',
            mint: 'So11111111111111111111111111111111111111112',
            createdAt: DateTime.fromISO('2025-01-15T12:00:00Z'),
          },
        ],
      } as any);

      const spec: ExportSlicesForAlertsSpec = {
        fromISO: '2025-01-15T00:00:00Z',
        toISO: '2025-01-16T00:00:00Z',
        catalogBasePath: './catalog',
        dataset: 'candles_1m',
        chain: 'sol',
      };

      const result = await exportSlicesForAlerts(spec, mockContext);

      expect(result.success).toBe(true);
      expect(result.failedExports).toBe(1);
      expect(result.exports[0]?.success).toBe(false);
      expect(result.exports[0]?.error).toBeDefined();
      expect(result.exports[0]?.error).not.toBe('');
    });
  });
});
