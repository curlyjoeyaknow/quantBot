/**
 * Unit tests for Initialization Manager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeStorage,
  checkStorageHealth,
  ensureInitialized,
} from '../../src/core/initialization-manager';
import { initClickHouse, getClickHouseClient } from '@quantbot/storage';
import { getPostgresPool } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

vi.mock('@quantbot/storage', () => ({
  initClickHouse: vi.fn(),
  getClickHouseClient: vi.fn(),
  getPostgresPool: vi.fn(),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('InitializationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeStorage', () => {
    it('should initialize both ClickHouse and Postgres successfully', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockPostgresPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(initClickHouse).mockResolvedValue(undefined);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(true);
      expect(status.postgres).toBe(true);
      expect(status.initialized).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('ClickHouse initialized');
      expect(logger.info).toHaveBeenCalledWith('PostgreSQL initialized');
    });

    it('should handle ClickHouse initialization failure gracefully', async () => {
      const mockPostgresPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(initClickHouse).mockRejectedValue(new Error('ClickHouse error'));
      vi.mocked(getClickHouseClient).mockReturnValue(null);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(false);
      expect(status.postgres).toBe(true);
      expect(status.initialized).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'ClickHouse initialization failed',
        expect.any(Error)
      );
    });

    it('should handle Postgres initialization failure gracefully', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockPostgresPool = {
        query: vi.fn().mockRejectedValue(new Error('Postgres error')),
      };

      vi.mocked(initClickHouse).mockResolvedValue(undefined);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(true);
      expect(status.postgres).toBe(false);
      expect(status.initialized).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'PostgreSQL initialization failed',
        expect.any(Error)
      );
    });

    it('should handle both storage backends failing', async () => {
      vi.mocked(initClickHouse).mockRejectedValue(new Error('ClickHouse error'));
      vi.mocked(getClickHouseClient).mockReturnValue(null);
      vi.mocked(getPostgresPool).mockReturnValue(null);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(false);
      expect(status.postgres).toBe(false);
      expect(status.initialized).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'No storage backends initialized. Some commands may not work.'
      );
    });

    it('should handle Postgres connection test failure', async () => {
      const mockPostgresPool = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      vi.mocked(initClickHouse).mockResolvedValue(undefined);
      vi.mocked(getClickHouseClient).mockReturnValue(null);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const status = await initializeStorage();

      expect(status.postgres).toBe(false);
      expect(status.initialized).toBe(false);
    });
  });

  describe('checkStorageHealth', () => {
    it('should report healthy status for both backends', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockPostgresPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const health = await checkStorageHealth();

      expect(health.healthy).toBe(true);
      expect(health.details.clickhouse?.healthy).toBe(true);
      expect(health.details.postgres?.healthy).toBe(true);
    });

    it('should report unhealthy status when ClickHouse fails', async () => {
      const mockPostgresPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(null);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const health = await checkStorageHealth();

      expect(health.healthy).toBe(true); // Postgres is healthy
      expect(health.details.clickhouse?.healthy).toBe(false);
      expect(health.details.clickhouse?.error).toBe('Not initialized');
      expect(health.details.postgres?.healthy).toBe(true);
    });

    it('should report unhealthy status when Postgres fails', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(null);

      const health = await checkStorageHealth();

      expect(health.healthy).toBe(true); // ClickHouse is healthy
      expect(health.details.postgres?.healthy).toBe(false);
      expect(health.details.postgres?.error).toBe('Not initialized');
    });

    it('should handle ClickHouse ping errors', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockRejectedValue(new Error('Ping failed')),
      };
      const mockPostgresPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const health = await checkStorageHealth();

      expect(health.details.clickhouse?.healthy).toBe(false);
      expect(health.details.clickhouse?.error).toBe('Ping failed');
    });

    it('should handle Postgres query errors', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockPostgresPool = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const health = await checkStorageHealth();

      expect(health.details.postgres?.healthy).toBe(false);
      expect(health.details.postgres?.error).toBe('Query failed');
    });
  });

  describe('ensureInitialized', () => {
    it('should return cached initialization promise', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockPostgresPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(initClickHouse).mockResolvedValue(undefined);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);
      vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as never);

      const promise1 = ensureInitialized();
      const promise2 = ensureInitialized();

      // Both should resolve to the same status
      const [status1, status2] = await Promise.all([promise1, promise2]);
      expect(status1.initialized).toBe(true);
      expect(status2.initialized).toBe(true);
      // Both should have same values
      expect(status1).toEqual(status2);
    });
  });
});
