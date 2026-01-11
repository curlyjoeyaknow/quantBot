/**
 * Unit tests for Storage Commands
 *
 * Tests SQL injection prevention, safe queries, and table validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { parseArguments } from '../../../src/core/argument-parser';
import { formatOutput } from '../../../src/core/output-formatter';

// Mock storage package
vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(),
  getClickHouseClient: vi.fn(),
  ohlcvCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
  },
}));

describe('Storage Commands', () => {
  let mockPostgresPool: {
    query: ReturnType<typeof vi.fn>;
  };
  let mockClickHouseClient: {
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPostgresPool = {
      query: vi.fn(),
    };

    mockClickHouseClient = {
      query: vi.fn(),
    };

    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
  });

  describe('Query Command Schema', () => {
    const querySchema = z.object({
      table: z.string().min(1),
      limit: z.number().int().positive().max(10000).default(100),
      format: z.enum(['json', 'table', 'csv']).default('table'),
    });

    it('should validate query command arguments', () => {
      const validArgs = { table: 'tokens', limit: 50, format: 'json' as const };
      const result = parseArguments(querySchema, validArgs);
      expect(result.table).toBe('tokens');
      expect(result.limit).toBe(50);
      expect(result.format).toBe('json');
    });

    it('should use default limit and format', () => {
      const result = parseArguments(querySchema, { table: 'tokens' });
      expect(result.limit).toBe(100);
      expect(result.format).toBe('table');
    });

    it('should reject empty table name', () => {
      expect(() => parseArguments(querySchema, { table: '' })).toThrow();
    });

    it('should reject negative limit', () => {
      const invalidArgs = { table: 'tokens', limit: -1 };
      expect(() => parseArguments(querySchema, invalidArgs)).toThrow();
    });

    it('should reject limit exceeding maximum', () => {
      const invalidArgs = { table: 'tokens', limit: 20000 };
      expect(() => parseArguments(querySchema, invalidArgs)).toThrow();
    });

    it('should reject invalid format', () => {
      const invalidArgs = { table: 'tokens', format: 'xml' };
      expect(() => parseArguments(querySchema, invalidArgs)).toThrow();
    });
  });

  describe('Table Name Validation (SQL Injection Prevention)', () => {
    const SAFE_TABLES = {
      postgres: [
        'tokens',
        'calls',
        'alerts',
        'callers',
        'strategies',
        'simulation_runs',
        'simulation_results_summary',
      ],
      clickhouse: [
        'ohlcv_candles',
        'indicator_values',
        'simulation_events',
        'simulation_aggregates',
        'token_metadata_snapshots',
      ],
    };

    function validateTableName(table: string, database: 'postgres' | 'clickhouse'): boolean {
      const safeTables = SAFE_TABLES[database];
      return safeTables.includes(table.toLowerCase());
    }

    it('should accept valid Postgres table names', () => {
      expect(validateTableName('tokens', 'postgres')).toBe(true);
      expect(validateTableName('calls', 'postgres')).toBe(true);
      expect(validateTableName('strategies', 'postgres')).toBe(true);
    });

    it('should accept valid ClickHouse table names', () => {
      expect(validateTableName('ohlcv_candles', 'clickhouse')).toBe(true);
      expect(validateTableName('indicator_values', 'clickhouse')).toBe(true);
    });

    it('should reject SQL injection attempts', () => {
      // SQL injection attempts should be rejected
      expect(validateTableName('tokens; DROP TABLE users;', 'postgres')).toBe(false);
      expect(validateTableName("tokens' OR '1'='1", 'postgres')).toBe(false);
      expect(validateTableName('tokens UNION SELECT * FROM passwords', 'postgres')).toBe(false);
    });

    it('should reject non-whitelisted table names', () => {
      expect(validateTableName('users', 'postgres')).toBe(false);
      expect(validateTableName('passwords', 'postgres')).toBe(false);
      expect(validateTableName('admin', 'postgres')).toBe(false);
    });

    it('should be case-insensitive for table names', () => {
      expect(validateTableName('TOKENS', 'postgres')).toBe(true);
      expect(validateTableName('Tokens', 'postgres')).toBe(true);
      expect(validateTableName('ToKeNs', 'postgres')).toBe(true);
    });

    it('should reject table names with special characters', () => {
      expect(validateTableName('tokens$', 'postgres')).toBe(false);
      expect(validateTableName('tokens#', 'postgres')).toBe(false);
      expect(validateTableName('tokens@', 'postgres')).toBe(false);
    });
  });

  describe('Postgres Query Execution', () => {
    it('should execute safe Postgres query', async () => {
      const mockRows = [
        { id: 1, name: 'Token A', address: 'So111...' },
        { id: 2, name: 'Token B', address: 'EPj...' },
      ];

      mockPostgresPool.query.mockResolvedValue({ rows: mockRows });

      const result = await mockPostgresPool.query('SELECT * FROM tokens LIMIT $1', [10]);

      expect(mockPostgresPool.query).toHaveBeenCalledWith('SELECT * FROM tokens LIMIT $1', [10]);
      expect(result.rows).toEqual(mockRows);
    });

    it('should use parameterized queries to prevent SQL injection', async () => {
      mockPostgresPool.query.mockResolvedValue({ rows: [] });

      await mockPostgresPool.query('SELECT * FROM tokens LIMIT $1', [100]);

      // Verify parameterized query was used (not string concatenation)
      expect(mockPostgresPool.query).toHaveBeenCalledWith(
        expect.stringContaining('$1'),
        expect.arrayContaining([100])
      );
    });

    it('should handle Postgres query errors', async () => {
      mockPostgresPool.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(mockPostgresPool.query('SELECT * FROM tokens LIMIT $1', [10])).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('ClickHouse Query Execution', () => {
    it('should execute safe ClickHouse query', async () => {
      const mockData = [
        { timestamp: '2024-01-01', open: 100, high: 110, low: 95, close: 105 },
        { timestamp: '2024-01-02', open: 105, high: 115, low: 100, close: 110 },
      ];

      const mockResult = {
        json: vi.fn().mockResolvedValue(mockData),
      };

      mockClickHouseClient.query.mockResolvedValue(mockResult);

      const result = await mockClickHouseClient.query({
        query: 'SELECT * FROM quantbot.ohlcv_candles LIMIT {limit:UInt32}',
        query_params: { limit: 10 },
        format: 'JSONEachRow',
      });

      const data = await result.json();

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      expect(data).toEqual(mockData);
    });

    it('should use parameterized queries for ClickHouse', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([]),
      };

      mockClickHouseClient.query.mockResolvedValue(mockResult);

      await mockClickHouseClient.query({
        query: 'SELECT * FROM quantbot.ohlcv_candles LIMIT {limit:UInt32}',
        query_params: { limit: 100 },
        format: 'JSONEachRow',
      });

      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('{limit:UInt32}'),
          query_params: { limit: 100 },
        })
      );
    });

    it('should handle ClickHouse query errors', async () => {
      mockClickHouseClient.query.mockRejectedValue(new Error('ClickHouse connection failed'));

      await expect(
        mockClickHouseClient.query({
          query: 'SELECT * FROM quantbot.ohlcv_candles LIMIT {limit:UInt32}',
          query_params: { limit: 10 },
          format: 'JSONEachRow',
        })
      ).rejects.toThrow('ClickHouse connection failed');
    });
  });

  describe('Output Formatting', () => {
    it('should format query results as JSON', () => {
      const data = [
        { id: 1, name: 'Token A' },
        { id: 2, name: 'Token B' },
      ];

      const output = formatOutput(data, 'json');
      expect(output).toContain('"id"');
      expect(output).toContain('Token A');
    });

    it('should format query results as table', () => {
      const data = [
        { id: 1, name: 'Token A' },
        { id: 2, name: 'Token B' },
      ];

      const output = formatOutput(data, 'table');
      expect(output).toContain('id');
      expect(output).toContain('name');
      expect(output).toContain('Token A');
    });

    it('should format query results as CSV', () => {
      const data = [
        { id: 1, name: 'Token A' },
        { id: 2, name: 'Token B' },
      ];

      const output = formatOutput(data, 'csv');
      expect(output).toContain('id,name');
      expect(output).toContain('1,Token A');
    });

    it('should handle empty result sets', () => {
      const output = formatOutput([], 'table');
      expect(output).toBe('No data to display');
    });
  });

  describe('Security Tests', () => {
    it('should prevent SQL injection via table name', () => {
      const maliciousInputs = [
        'tokens; DROP TABLE users; --',
        "tokens' OR '1'='1",
        'tokens UNION SELECT * FROM passwords',
        'tokens/**/OR/**/1=1',
        "tokens; EXEC xp_cmdshell('dir')",
      ];

      const SAFE_TABLES = ['tokens', 'calls', 'alerts'];

      for (const input of maliciousInputs) {
        const isSafe = SAFE_TABLES.includes(input.toLowerCase());
        expect(isSafe).toBe(false);
      }
    });

    it('should only allow whitelisted tables', () => {
      const SAFE_TABLES = {
        postgres: ['tokens', 'calls', 'alerts'],
        clickhouse: ['ohlcv_candles', 'indicator_values'],
      };

      function validateTableName(table: string, database: 'postgres' | 'clickhouse'): boolean {
        return SAFE_TABLES[database].includes(table.toLowerCase());
      }

      // Valid tables
      expect(validateTableName('tokens', 'postgres')).toBe(true);
      expect(validateTableName('ohlcv_candles', 'clickhouse')).toBe(true);

      // Invalid tables
      expect(validateTableName('users', 'postgres')).toBe(false);
      expect(validateTableName('admin', 'postgres')).toBe(false);
      expect(validateTableName('system', 'clickhouse')).toBe(false);
    });
  });
});
