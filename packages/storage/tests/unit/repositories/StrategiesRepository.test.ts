import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrategiesRepository } from '../../src/postgres/repositories/StrategiesRepository';
import { getPostgresPool } from '../../src/postgres-client';

vi.mock('../../src/postgres-client', () => ({
  getPostgresPool: vi.fn(),
}));

describe('StrategiesRepository', () => {
  let repository: StrategiesRepository;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new StrategiesRepository();
    mockPool = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
  });

  describe('findAllActive', () => {
    it('should find all active strategies', async () => {
      const mockStrategies = [
        {
          id: 1,
          name: 'Test Strategy',
          version: '1.0',
          category: 'test',
          description: 'Test description',
          config_json: { key: 'value' },
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
      mockPool.query.mockResolvedValue({ rows: mockStrategies });

      const result = await repository.findAllActive();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Strategy');
    });
  });

  describe('findByName', () => {
    it('should find strategy by name', async () => {
      const mockStrategy = {
        id: 1,
        name: 'Test Strategy',
        version: '1.0',
        category: null,
        description: null,
        config_json: {},
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockPool.query.mockResolvedValue({ rows: [mockStrategy] });

      const result = await repository.findByName('Test Strategy');

      expect(result).toBeDefined();
      expect(result?.name).toBe('Test Strategy');
    });

    it('should return null if strategy not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repository.findByName('NonExistent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new strategy', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await repository.create({
        name: 'New Strategy',
        config: { key: 'value' },
      });

      expect(result).toBe(1);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle optional fields', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 2 }] });

      await repository.create({
        name: 'Strategy',
        version: '1.0',
        category: 'test',
        description: 'Description',
        config: {},
        isActive: true,
      });

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain('1.0');
    });
  });
});
