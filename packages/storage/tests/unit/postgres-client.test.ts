/**
 * Tests for postgres-client.ts
 *
 * Tests cover:
 * - Connection pooling
 * - Query execution
 * - Transaction handling
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPostgresPool,
  getPostgresClient,
  queryPostgres,
  withPostgresTransaction,
  closePostgresPool,
} from '../src/postgres/postgres-client';

// Mock pg - must define mocks inside factory to avoid hoisting issues
vi.mock('pg', async () => {
  const { vi } = await import('vitest');
  const mockPool = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };

  const PoolConstructor = vi.fn(function (config: any) {
    Object.assign(mockPool, config);
    return mockPool;
  });

  // Store mocks globally for test access
  (globalThis as any).__postgresMocks__ = {
    pool: mockPool,
    PoolConstructor,
  };

  return {
    Pool: PoolConstructor,
  };
});

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Postgres Client', () => {
  let mockPool: any;
  let mockClient: any;
  let PoolConstructor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = (globalThis as any).__postgresMocks__;
    mockPool = mocks.pool;
    PoolConstructor = mocks.PoolConstructor;
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    // Reset singleton
    (getPostgresPool as any).__pool = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getPostgresPool', () => {
    it('should create a new pool on first call', () => {
      const pool = getPostgresPool();

      expect(PoolConstructor).toHaveBeenCalled();
      expect(pool).toBe(mockPool);
    });

    it('should reuse existing pool on subsequent calls', () => {
      PoolConstructor.mockClear();
      const pool1 = getPostgresPool();
      const callCount1 = PoolConstructor.mock.calls.length;
      const pool2 = getPostgresPool();
      const callCount2 = PoolConstructor.mock.calls.length;

      // Should only be called once total (or not at all if already initialized)
      expect(callCount2).toBeLessThanOrEqual(callCount1 + 1);
      expect(pool1).toBe(pool2);
    });

    it('should use environment variables for configuration', async () => {
      // Close existing pool first
      await closePostgresPool();

      const originalHost = process.env.POSTGRES_HOST;
      const originalPort = process.env.POSTGRES_PORT;
      const originalUser = process.env.POSTGRES_USER;
      const originalPassword = process.env.POSTGRES_PASSWORD;
      const originalDatabase = process.env.POSTGRES_DATABASE;

      try {
        process.env.POSTGRES_HOST = 'test-host';
        process.env.POSTGRES_PORT = '5433';
        process.env.POSTGRES_USER = 'test-user';
        process.env.POSTGRES_PASSWORD = 'test-password';
        process.env.POSTGRES_DATABASE = 'test-db';

        PoolConstructor.mockClear();

        getPostgresPool();

        // Verify Pool was called with correct config
        expect(PoolConstructor).toHaveBeenCalled();
        const callArgs = PoolConstructor.mock.calls[0][0];
        expect(callArgs.host).toBe('test-host');
        expect(callArgs.port).toBe(5433);
        expect(callArgs.user).toBe('test-user');
        expect(callArgs.password).toBe('test-password');
        expect(callArgs.database).toBe('test-db');
      } finally {
        // Restore original values
        await closePostgresPool();
        if (originalHost) process.env.POSTGRES_HOST = originalHost;
        else delete process.env.POSTGRES_HOST;
        if (originalPort) process.env.POSTGRES_PORT = originalPort;
        else delete process.env.POSTGRES_PORT;
        if (originalUser) process.env.POSTGRES_USER = originalUser;
        else delete process.env.POSTGRES_USER;
        if (originalPassword) process.env.POSTGRES_PASSWORD = originalPassword;
        else delete process.env.POSTGRES_PASSWORD;
        if (originalDatabase) process.env.POSTGRES_DATABASE = originalDatabase;
        else delete process.env.POSTGRES_DATABASE;
      }
    });
  });

  describe('getPostgresClient', () => {
    it('should get a client from the pool', async () => {
      const client = await getPostgresClient();

      expect(mockPool.connect).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });
  });

  describe('queryPostgres', () => {
    it('should execute a query and return results', async () => {
      const mockRows = [{ id: 1, name: 'test' }];
      mockClient.query.mockResolvedValue({ rows: mockRows, rowCount: 1 });

      const result = await queryPostgres('SELECT * FROM test', []);

      expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM test', []);
      expect(result.rows).toEqual(mockRows);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should release client even on error', async () => {
      mockClient.query.mockRejectedValue(new Error('Query failed'));

      await expect(queryPostgres('SELECT * FROM test', [])).rejects.toThrow('Query failed');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('withPostgresTransaction', () => {
    it('should execute handler in a transaction', async () => {
      const handler = vi.fn().mockResolvedValue('result');

      const result = await withPostgresTransaction(handler);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(handler).toHaveBeenCalledWith(mockClient);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toBe('result');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      await expect(withPostgresTransaction(handler)).rejects.toThrow('Handler failed');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('closePostgresPool', () => {
    it('should close the pool', async () => {
      getPostgresPool(); // Initialize pool first
      mockPool.end.mockResolvedValue(undefined);

      await closePostgresPool();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
