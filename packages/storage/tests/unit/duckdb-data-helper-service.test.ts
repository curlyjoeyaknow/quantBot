/**
 * Tests for DuckDB Data Helper Service
 *
 * Tests validation, schema queries, and error messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DuckDBDataHelperService,
  DEFAULT_DB_PATH,
} from '../../src/duckdb/duckdb-data-helper-service.js';
import { PythonEngine } from '@quantbot/infra/utils';

// Mock PythonEngine
vi.mock('@quantbot/infra/utils', () => ({
  PythonEngine: vi.fn(),
  getPythonEngine: vi.fn(),
  findWorkspaceRoot: vi.fn(() => '/workspace'),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('DuckDBDataHelperService', () => {
  let mockPythonEngine: any;
  let service: DuckDBDataHelperService;

  beforeEach(() => {
    mockPythonEngine = {
      runScript: vi.fn(),
    };
    (PythonEngine as any).mockImplementation(() => mockPythonEngine);
    service = new DuckDBDataHelperService(DEFAULT_DB_PATH, mockPythonEngine);
  });

  describe('queryAlerts', () => {
    it('should query alerts successfully', async () => {
      const mockAlerts = [
        {
          alert_id: '123:456',
          alert_ts_ms: 1609459200000,
          mint: 'So11111111111111111111111111111111111111112',
          caller_name_norm: 'brook',
        },
      ];

      mockPythonEngine.runScript.mockResolvedValue({
        success: true,
        alerts: mockAlerts,
      });

      const result = await service.queryAlerts({ limit: 10 });

      expect(result).toEqual(mockAlerts);
      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          operation: 'query_alerts',
          'db-path': DEFAULT_DB_PATH,
        }),
        expect.any(Object)
      );
    });

    it('should handle query errors', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        success: false,
        error: 'View not found',
      });

      await expect(service.queryAlerts({})).rejects.toThrow('Failed to query alerts');
    });

    it('should pass filters correctly', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        success: true,
        alerts: [],
      });

      const filters = {
        caller_name: 'brook',
        from_ts_ms: 1609459200000,
        to_ts_ms: 1640995200000,
        limit: 100,
      };

      await service.queryAlerts(filters);

      const callArgs = mockPythonEngine.runScript.mock.calls[0][1];
      const parsedFilters = JSON.parse(callArgs.filters as string);
      expect(parsedFilters).toEqual(filters);
    });
  });

  describe('queryCallers', () => {
    it('should query callers successfully', async () => {
      const mockCallers = [
        {
          caller_id: '1',
          caller_raw_name: 'brook',
          caller_name_norm: 'brook',
          caller_base: 'brook',
        },
      ];

      mockPythonEngine.runScript.mockResolvedValue({
        success: true,
        callers: mockCallers,
      });

      const result = await service.queryCallers({});

      expect(result).toEqual(mockCallers);
      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          operation: 'query_callers',
          'db-path': DEFAULT_DB_PATH,
        }),
        expect.any(Object)
      );
    });
  });

  describe('validateView', () => {
    it('should validate valid view names', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        success: true,
      });

      const result = await service.validateView('alerts_std', 'canon');

      expect(result).toBe(true);
      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          operation: 'validate_view',
          'view-name': 'alerts_std',
          schema: 'canon',
        }),
        expect.any(Object)
      );
    });

    it('should reject invalid view names', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        success: false,
        error: 'View does not exist',
      });

      await expect(service.validateView('nonexistent_view', 'canon')).rejects.toThrow(
        'View does not exist'
      );
    });

    it('should reject deprecated view names with helpful message', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        success: false,
        error: 'View canon.alerts_canon is deprecated. Use: canon.alerts_std',
      });

      await expect(service.validateView('alerts_canon', 'canon')).rejects.toThrow('deprecated');
    });
  });

  describe('getViewSchema', () => {
    it('should get view schema successfully', async () => {
      const mockSchema = {
        view_name: 'alerts_std',
        schema: 'canon',
        description: 'Primary canonical alert view',
        columns: [
          { name: 'alert_id', type: 'VARCHAR' },
          { name: 'alert_ts_ms', type: 'BIGINT' },
        ],
        primary: true,
      };

      mockPythonEngine.runScript.mockResolvedValue({
        success: true,
        schema: mockSchema,
      });

      const result = await service.getViewSchema('alerts_std', 'canon');

      expect(result).toEqual(mockSchema);
      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          operation: 'get_view_schema',
          'view-name': 'alerts_std',
          schema: 'canon',
        }),
        expect.any(Object)
      );
    });
  });

  describe('getDatabaseInfo', () => {
    it('should get database info successfully', async () => {
      const mockInfo = {
        schemas: ['canon', 'core', 'raw'],
        canon_views: ['alerts_std', 'callers_d'],
        view_count: 2,
        alerts_count: 7317,
      };

      mockPythonEngine.runScript.mockResolvedValue({
        success: true,
        info: mockInfo,
      });

      const result = await service.getDatabaseInfo();

      expect(result).toEqual(mockInfo);
      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          operation: 'get_database_info',
          'db-path': DEFAULT_DB_PATH,
        }),
        expect.any(Object)
      );
    });
  });

  describe('getDbPath', () => {
    it('should return the database path', () => {
      expect(service.getDbPath()).toBe(DEFAULT_DB_PATH);
    });
  });
});
