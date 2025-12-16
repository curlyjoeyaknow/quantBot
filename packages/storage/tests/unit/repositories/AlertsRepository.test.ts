import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { AlertsRepository } from '../../../src/postgres/repositories/AlertsRepository';
import { getPostgresPool, withPostgresTransaction } from '../../../src/postgres/postgres-client';
import { createTokenAddress } from '@quantbot/core';

vi.mock('../../../src/postgres/postgres-client', () => ({
  getPostgresPool: vi.fn(),
  withPostgresTransaction: vi.fn(),
}));

describe('AlertsRepository', () => {
  let repository: AlertsRepository;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new AlertsRepository();
    mockClient = {
      query: vi.fn(),
    };
    vi.mocked(withPostgresTransaction).mockImplementation(async (callback: any) => {
      return callback(mockClient);
    });
  });

  describe('insertAlert', () => {
    it('should insert a new alert', async () => {
      // First call: check for existing (no chatId/messageId, so this check is skipped)
      // Second call: insert
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const result = await repository.insertAlert({
        tokenId: 1,
        side: 'buy',
        alertTimestamp: new Date(),
      });

      expect(result).toBe(1);
      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should return existing alert ID if chatId and messageId match', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // Existing found

      const result = await repository.insertAlert({
        tokenId: 1,
        side: 'buy',
        alertTimestamp: new Date(),
        chatId: '123',
        messageId: '456',
      });

      expect(result).toBe(5);
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    it('should handle caller and strategy IDs', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });

      await repository.insertAlert({
        tokenId: 1,
        callerId: 10,
        strategyId: 20,
        side: 'buy',
        alertTimestamp: new Date(),
      });

      const insertCall = mockClient.query.mock.calls[0];
      expect(insertCall[1]).toContain(10);
      expect(insertCall[1]).toContain(20);
    });
  });

  describe('findByCaller', () => {
    it('should find alerts by caller ID', async () => {
      const mockAlerts = [
        {
          id: 1,
          token_id: 1,
          caller_id: 10,
          side: 'buy',
          alert_timestamp: new Date(),
          alert_price: 1.0,
          raw_payload_json: {},
          created_at: new Date(),
        },
      ];
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: mockAlerts }),
      };
      vi.mocked(getPostgresPool).mockReturnValue(pool as any);

      const result = await repository.findByCaller(10);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('findByTimeRange', () => {
    it('should find alerts in time range', async () => {
      const mockAlerts = [
        {
          id: 1,
          token_id: 1,
          side: 'buy',
          alert_timestamp: new Date(),
          alert_price: 1.0,
          raw_payload_json: {},
          created_at: new Date(),
        },
      ];
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: mockAlerts }),
      };
      vi.mocked(getPostgresPool).mockReturnValue(pool as any);

      const from = new Date('2024-01-01');
      const to = new Date('2024-01-02');
      const result = await repository.findByTimeRange(from, to);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });
});
