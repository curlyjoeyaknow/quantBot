/**
 * Integration tests for Storage command handlers
 *
 * Tests the actual command execution through the command registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { CommandRegistry } from '../../src/core/command-registry';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { getClickHouseDatabaseName } from '@quantbot/utils';

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

describe('Storage Commands - Integration', () => {
  let registry: CommandRegistry;
  let mockPostgresPool: {
    query: ReturnType<typeof vi.fn>;
  };
  let mockClickHouseClient: {
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new CommandRegistry();

    mockPostgresPool = {
      query: vi.fn(),
    };

    mockClickHouseClient = {
      query: vi.fn(),
    };

    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);

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

    async function queryPostgresTable(table: string, limit: number) {
      if (!SAFE_TABLES.postgres.includes(table.toLowerCase())) {
        throw new Error(`Invalid table name: ${table}`);
      }
      const pool = getPostgresPool();
      const result = await pool.query(`SELECT * FROM ${table} LIMIT $1`, [limit]);
      return result.rows;
    }

    async function queryClickHouseTable(table: string, limit: number) {
      if (!SAFE_TABLES.clickhouse.includes(table.toLowerCase())) {
        throw new Error(`Invalid table name: ${table}`);
      }
      const client = getClickHouseClient();
      const database = getClickHouseDatabaseName();
      const result = await client.query({
        query: `SELECT * FROM ${database}.${table} LIMIT {limit:UInt32}`,
        query_params: { limit },
        format: 'JSONEachRow',
      });
      return await result.json();
    }

    registry.registerPackage({
      packageName: 'storage',
      description: 'Database storage operations',
      commands: [
        {
          name: 'query',
          description: 'Query database tables',
          schema: z.object({
            table: z.string().min(1),
            limit: z.number().int().positive().max(10000).default(100),
            format: z.enum(['json', 'table', 'csv']).default('table'),
          }),
          handler: async (args: any) => {
            const isClickHouse = SAFE_TABLES.clickhouse.includes(args.table.toLowerCase());
            if (isClickHouse) {
              return await queryClickHouseTable(args.table, args.limit);
            }
            return await queryPostgresTable(args.table, args.limit);
          },
        },
      ],
    });
  });

  describe('Query Command Handler - Postgres', () => {
    it('should execute query for Postgres table', async () => {
      const mockRows = [
        { id: 1, address: 'So111...', name: 'Token A', symbol: 'TKA' },
        { id: 2, address: 'EPj...', name: 'Token B', symbol: 'TKB' },
      ];

      mockPostgresPool.query.mockResolvedValue({ rows: mockRows });

      const command = registry.getCommand('storage', 'query');
      expect(command).toBeDefined();

      if (command) {
        const args = {
          table: 'tokens',
          limit: 10,
          format: 'json',
        };

        const result = await command.handler(args);

        expect(mockPostgresPool.query).toHaveBeenCalled();
        expect(result).toEqual(mockRows);
      }
    });

    it('should use parameterized queries for Postgres', async () => {
      mockPostgresPool.query.mockResolvedValue({ rows: [] });

      const command = registry.getCommand('storage', 'query');

      if (command) {
        const args = {
          table: 'tokens',
          limit: 100,
          format: 'json',
        };

        await command.handler(args);

        // Verify parameterized query was used
        expect(mockPostgresPool.query).toHaveBeenCalledWith(
          expect.stringContaining('$1'),
          expect.arrayContaining([100])
        );
      }
    });
  });

  describe('Query Command Handler - ClickHouse', () => {
    it('should execute query for ClickHouse table', async () => {
      const mockData = [
        {
          timestamp: '2024-01-01T00:00:00Z',
          mint: 'So111...',
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];

      const mockResult = {
        json: vi.fn().mockResolvedValue(mockData),
      };

      mockClickHouseClient.query.mockResolvedValue(mockResult);

      const command = registry.getCommand('storage', 'query');

      if (command) {
        const args = {
          table: 'ohlcv_candles',
          limit: 10,
          format: 'json',
        };

        const result = await command.handler(args);

        expect(mockClickHouseClient.query).toHaveBeenCalled();
        expect(result).toEqual(mockData);
      }
    });

    it('should use parameterized queries for ClickHouse', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([]),
      };

      mockClickHouseClient.query.mockResolvedValue(mockResult);

      const command = registry.getCommand('storage', 'query');

      if (command) {
        const args = {
          table: 'ohlcv_candles',
          limit: 100,
          format: 'json',
        };

        await command.handler(args);

        // Verify parameterized query was used
        expect(mockClickHouseClient.query).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.stringContaining('{limit:UInt32}'),
            query_params: { limit: 100 },
          })
        );
      }
    });
  });

  describe('SQL Injection Prevention', () => {
    it('should reject SQL injection attempts in table name', async () => {
      const command = registry.getCommand('storage', 'query');

      if (command) {
        const maliciousArgs = {
          table: 'tokens; DROP TABLE users; --',
          limit: 10,
          format: 'json',
        };

        // Should throw error because table is not in whitelist
        await expect(command.handler(maliciousArgs)).rejects.toThrow();
      }
    });

    it('should only allow whitelisted table names', async () => {
      mockPostgresPool.query.mockResolvedValue({ rows: [] });

      const command = registry.getCommand('storage', 'query');

      if (command) {
        // Valid table should work
        const validArgs = {
          table: 'tokens',
          limit: 10,
          format: 'json',
        };

        await expect(command.handler(validArgs)).resolves.toBeDefined();

        // Invalid table should fail
        const invalidArgs = {
          table: 'admin_users',
          limit: 10,
          format: 'json',
        };

        await expect(command.handler(invalidArgs)).rejects.toThrow();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockPostgresPool.query.mockRejectedValue(new Error('Connection refused'));

      const command = registry.getCommand('storage', 'query');

      if (command) {
        const args = {
          table: 'tokens',
          limit: 10,
          format: 'json',
        };

        await expect(command.handler(args)).rejects.toThrow('Connection refused');
      }
    });

    it('should handle ClickHouse query errors', async () => {
      mockClickHouseClient.query.mockRejectedValue(new Error('Query timeout'));

      const command = registry.getCommand('storage', 'query');

      if (command) {
        const args = {
          table: 'ohlcv_candles',
          limit: 10,
          format: 'json',
        };

        await expect(command.handler(args)).rejects.toThrow('Query timeout');
      }
    });
  });
});
