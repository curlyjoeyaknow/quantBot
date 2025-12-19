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
import { logger } from '@quantbot/utils';

vi.mock('@quantbot/storage', () => ({
  initClickHouse: vi.fn(),
  getClickHouseClient: vi.fn(),
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
    it('should initialize ClickHouse successfully', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(initClickHouse).mockResolvedValue(undefined);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(true);
      expect(status.initialized).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('ClickHouse initialized');
    });

    it('should handle ClickHouse initialization failure gracefully', async () => {
      vi.mocked(initClickHouse).mockRejectedValue(new Error('ClickHouse error'));
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(false);
      expect(status.initialized).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'ClickHouse initialization failed',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should handle storage backend failing', async () => {
      vi.mocked(initClickHouse).mockRejectedValue(new Error('ClickHouse error'));
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      const status = await initializeStorage();

      expect(status.clickhouse).toBe(false);
      expect(status.initialized).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'No storage backends initialized. Some commands may not work.'
      );
    });
  });

  describe('checkStorageHealth', () => {
    it('should report healthy status for ClickHouse', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);

      const health = await checkStorageHealth();

      expect(health.healthy).toBe(true);
      expect(health.details.clickhouse?.healthy).toBe(true);
    });

    it('should report unhealthy status when ClickHouse fails', async () => {
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      const health = await checkStorageHealth();

      expect(health.healthy).toBe(false);
      expect(health.details.clickhouse?.healthy).toBe(false);
      expect(health.details.clickhouse?.error).toBe('Not initialized');
    });

    it('should handle ClickHouse ping errors', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockRejectedValue(new Error('Ping failed')),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);

      const health = await checkStorageHealth();

      expect(health.healthy).toBe(false);
      expect(health.details.clickhouse?.healthy).toBe(false);
      expect(health.details.clickhouse?.error).toBe('Ping failed');
    });
  });

  describe('ensureInitialized', () => {
    it('should return cached initialization promise', async () => {
      const mockClickHouseClient = {
        ping: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(initClickHouse).mockResolvedValue(undefined);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as never);

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
