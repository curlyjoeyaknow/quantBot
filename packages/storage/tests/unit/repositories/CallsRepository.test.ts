import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { CallsRepository } from '../../src/postgres/repositories/CallsRepository';
import { getPostgresPool } from '../../src/postgres-client';
import { createTokenAddress } from '@quantbot/core';

vi.mock('../../src/postgres-client', () => ({
  getPostgresPool: vi.fn(),
}));

describe('CallsRepository', () => {
  let repository: CallsRepository;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new CallsRepository();
    mockPool = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
  });

  describe('insertCall', () => {
    it('should insert a new call', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await repository.insertCall({
        tokenId: 1,
        side: 'buy',
        signalType: 'entry',
        signalTimestamp: new Date(),
      });

      expect(result).toBe(1);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle optional fields', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 2 }] });

      await repository.insertCall({
        alertId: 10,
        tokenId: 1,
        callerId: 5,
        strategyId: 3,
        side: 'buy',
        signalType: 'entry',
        signalStrength: 0.8,
        signalTimestamp: new Date(),
        metadata: { key: 'value' },
      });

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain(10); // alertId
      expect(call[1]).toContain(5); // callerId
      expect(call[1]).toContain(3); // strategyId
    });
  });

  describe('findByTokenId', () => {
    it('should find calls by token ID', async () => {
      const mockCalls = [
        {
          id: 1,
          token_id: 1,
          side: 'buy',
          signal_type: 'entry',
          signal_timestamp: new Date(),
        },
      ];
      mockPool.query.mockResolvedValue({ rows: mockCalls });

      const result = await repository.findByTokenId(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('queryBySelection', () => {
    it('should query calls by selection criteria', async () => {
      const mockCalls = [
        {
          id: 1,
          token_id: 1,
          side: 'buy',
          signal_type: 'entry',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: mockCalls });

      const result = await repository.queryBySelection({
        chain: 'solana',
        limit: 10,
      });

      expect(result).toHaveLength(1);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle caller name filter', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await repository.queryBySelection({
        callerName: 'test_caller',
        limit: 10,
      });

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('caller');
    });
  });
});
