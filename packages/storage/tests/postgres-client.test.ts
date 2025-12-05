import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import {
  getPostgresPool,
  getPostgresClient,
  queryPostgres,
  withPostgresTransaction,
  closePostgresPool,
} from '../../src/storage/postgres-client';

// Mock pg
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(() => mockPool),
  };
});

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('postgres-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configuration', () => {
    it('should create pool with default or env configuration', () => {
      const pool = getPostgresPool();
      expect(Pool).toHaveBeenCalled();
      expect(pool).toBeDefined();
    });
  });

  describe('getPostgresPool', () => {
    it('should create a new pool on first call', () => {
      const pool = getPostgresPool();
      expect(Pool).toHaveBeenCalled();
      expect(pool).toBeDefined();
    });

    it('should return the same pool instance on subsequent calls', () => {
      const pool1 = getPostgresPool();
      const pool2 = getPostgresPool();
      expect(pool1).toBe(pool2);
    });

    it('should configure pool with correct options', () => {
      const pool = getPostgresPool();
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        }),
      );
    });

    it('should set up error handler', () => {
      const pool = getPostgresPool();
      expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('getPostgresClient', () => {
    it('should get a client from the pool', async () => {
      vi.clearAllMocks();
      const pool = getPostgresPool();
      const client = await getPostgresClient();

      expect(mockPool.connect).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });
  });

  describe('queryPostgres', () => {
    it('should execute a query and return results', async () => {
      vi.clearAllMocks();
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
      });

      const result = await queryPostgres<{ id: number; name: string }>(
        'SELECT * FROM test',
      );

      expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM test', undefined);
      expect(result.rows).toEqual([{ id: 1, name: 'test' }]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should pass parameters to query', async () => {
      vi.clearAllMocks();
      mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await queryPostgres('SELECT * FROM test WHERE id = $1', [123]);

      expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM test WHERE id = $1', [123]);
    });

    it('should release client even if query fails', async () => {
      vi.clearAllMocks();
      mockClient.query.mockRejectedValueOnce(new Error('Query failed'));

      await expect(queryPostgres('SELECT * FROM test')).rejects.toThrow('Query failed');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('withPostgresTransaction', () => {
    it('should execute handler within a transaction', async () => {
      vi.clearAllMocks();
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const handler = vi.fn().mockResolvedValue('result');

      const result = await withPostgresTransaction(handler);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(handler).toHaveBeenCalledWith(mockClient);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should rollback on error', async () => {
      vi.clearAllMocks();
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      await expect(withPostgresTransaction(handler)).rejects.toThrow('Handler failed');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle rollback errors gracefully', async () => {
      vi.clearAllMocks();
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockRejectedValueOnce(new Error('Rollback failed')); // ROLLBACK fails

      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      await expect(withPostgresTransaction(handler)).rejects.toThrow('Handler failed');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('closePostgresPool', () => {
    it('should close the pool', async () => {
      vi.clearAllMocks();
      getPostgresPool();
      await closePostgresPool();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});

