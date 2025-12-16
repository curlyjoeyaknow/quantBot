import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { CallersRepository } from '../../../src/postgres/repositories/CallersRepository';
import { getPostgresPool, withPostgresTransaction } from '../../../src/postgres/postgres-client';

vi.mock('../../../src/postgres/postgres-client', () => ({
  getPostgresPool: vi.fn(),
  withPostgresTransaction: vi.fn(),
}));

describe('CallersRepository', () => {
  let repository: CallersRepository;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new CallersRepository();
    mockClient = {
      query: vi.fn(),
    };
    vi.mocked(withPostgresTransaction).mockImplementation(async (callback: any) => {
      return callback(mockClient);
    });
  });

  describe('getOrCreateCaller', () => {
    it('should return existing caller if found', async () => {
      const mockCaller = {
        id: 1,
        source: 'telegram',
        handle: 'test_caller',
        display_name: 'Test Caller',
        attributes_json: { key: 'value' },
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockCaller] });

      const result = await repository.getOrCreateCaller('telegram', 'test_caller');

      expect(result.id).toBe(1);
      expect(result.source).toBe('telegram');
      expect(result.handle).toBe('test_caller');
    });

    it('should create new caller if not found', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // Not found
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // Insert

      const result = await repository.getOrCreateCaller('telegram', 'new_caller', 'New Caller');

      expect(result.id).toBe(2);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('should handle optional displayName and attributes', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }] });

      await repository.getOrCreateCaller('telegram', 'caller', 'Display', { attr: 'value' });

      const insertCall = mockClient.query.mock.calls[1];
      expect(insertCall[1]).toContain('Display');
    });
  });

  describe('findById', () => {
    it('should find caller by ID', async () => {
      const mockCaller = {
        id: 1,
        source: 'telegram',
        handle: 'test',
        display_name: null,
        attributes_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [mockCaller] }),
      };
      vi.mocked(getPostgresPool).mockReturnValue(pool as any);

      const result = await repository.findById(1);

      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
    });

    it('should return null if caller not found', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      vi.mocked(getPostgresPool).mockReturnValue(pool as any);

      const result = await repository.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should find caller by source and handle', async () => {
      const mockCaller = {
        id: 1,
        source: 'telegram',
        handle: 'test',
        display_name: null,
        attributes_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [mockCaller] }),
      };
      vi.mocked(getPostgresPool).mockReturnValue(pool as any);

      const result = await repository.findByName('telegram', 'test');

      expect(result).toBeDefined();
      expect(result?.source).toBe('telegram');
    });
  });
});
