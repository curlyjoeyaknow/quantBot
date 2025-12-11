/**
 * Repository Pattern Tests
 * ========================
 * Tests for base repository implementation
 */

import { BaseRepository, IRepository } from '../../src/storage/repository';
import { DatabaseError, NotFoundError } from '../../src/utils/errors';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Test implementation
class TestRepository extends BaseRepository<{ id: number; name: string; value: number }, number> {
  protected tableName = 'test_table';
  protected idField = 'id';

  protected async executeQuery<R = any>(query: string, params?: any[]): Promise<R[]> {
    // Mock implementation
    return [] as R[];
  }

  protected async executeQueryOne<R = any>(query: string, params?: any[]): Promise<R | null> {
    // Mock implementation
    return null;
  }

  protected async executeCommand(query: string, params?: any[]): Promise<number> {
    // Mock implementation
    return 1;
  }

  protected mapRowToEntity(row: any): { id: number; name: string; value: number } {
    return {
      id: row.id,
      name: row.name,
      value: row.value,
    };
  }

  protected mapEntityToRow(entity: Partial<{ id: number; name: string; value: number }>): Record<string, any> {
    return {
      id: entity.id,
      name: entity.name,
      value: entity.value,
    };
  }
}

describe('BaseRepository', () => {
  let repository: TestRepository;

  beforeEach(() => {
    repository = new TestRepository();
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should find entity by ID', async () => {
      // Mock executeQueryOne to return a row
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue({
        id: 1,
        name: 'Test',
        value: 100,
      });

      const result = await repository.findById(1);

      expect(result).toEqual({ id: 1, name: 'Test', value: 100 });
      expect((repository as any).executeQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM test_table WHERE id = ?',
        [1]
      );
    });

    it('should return null when entity not found', async () => {
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue(null);

      const result = await repository.findById(1);

      expect(result).toBeNull();
    });

    it('should throw DatabaseError on query failure', async () => {
      jest.spyOn(repository as any, 'executeQueryOne').mockRejectedValue(new Error('DB error'));

      await expect(repository.findById(1)).rejects.toThrow(DatabaseError);
    });
  });

  describe('findAll', () => {
    it('should find all entities', async () => {
      jest.spyOn(repository as any, 'executeQuery').mockResolvedValue([
        { id: 1, name: 'Test1', value: 100 },
        { id: 2, name: 'Test2', value: 200 },
      ]);

      const result = await repository.findAll();

      expect(result).toHaveLength(2);
      expect((repository as any).executeQuery).toHaveBeenCalledWith('SELECT * FROM test_table', []);
    });

    it('should support limit', async () => {
      jest.spyOn(repository as any, 'executeQuery').mockResolvedValue([
        { id: 1, name: 'Test1', value: 100 },
      ]);

      await repository.findAll(10);

      expect((repository as any).executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM test_table LIMIT ?',
        [10]
      );
    });

    it('should support offset', async () => {
      jest.spyOn(repository as any, 'executeQuery').mockResolvedValue([]);

      await repository.findAll(10, 20);

      expect((repository as any).executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM test_table LIMIT ? OFFSET ?',
        [10, 20]
      );
    });

    it('should throw DatabaseError on query failure', async () => {
      jest.spyOn(repository as any, 'executeQuery').mockRejectedValue(new Error('DB error'));

      await expect(repository.findAll()).rejects.toThrow(DatabaseError);
    });
  });

  describe('create', () => {
    it('should create new entity', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockResolvedValue(1);
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue({
        id: 1,
        name: 'New',
        value: 50,
      });

      const result = await repository.create({ name: 'New', value: 50 });

      expect(result).toEqual({ id: 1, name: 'New', value: 50 });
      expect((repository as any).executeCommand).toHaveBeenCalled();
    });

    it('should throw NotFoundError if created entity cannot be fetched', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockResolvedValue(1);
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue(null);

      await expect(repository.create({ name: 'New', value: 50 })).rejects.toThrow(NotFoundError);
    });

    it('should throw DatabaseError on creation failure', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockRejectedValue(new Error('DB error'));

      await expect(repository.create({ name: 'New', value: 50 })).rejects.toThrow(DatabaseError);
    });
  });

  describe('update', () => {
    it('should update entity', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockResolvedValue(1);
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue({
        id: 1,
        name: 'Updated',
        value: 200,
      });

      const result = await repository.update(1, { name: 'Updated', value: 200 });

      expect(result).toEqual({ id: 1, name: 'Updated', value: 200 });
      expect((repository as any).executeCommand).toHaveBeenCalled();
    });

    it('should throw NotFoundError if updated entity cannot be fetched', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockResolvedValue(1);
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue(null);

      await expect(repository.update(1, { name: 'Updated' })).rejects.toThrow(NotFoundError);
    });

    it('should throw DatabaseError on update failure', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockRejectedValue(new Error('DB error'));

      await expect(repository.update(1, { name: 'Updated' })).rejects.toThrow(DatabaseError);
    });
  });

  describe('delete', () => {
    it('should delete entity and return true', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockResolvedValue(1);

      const result = await repository.delete(1);

      expect(result).toBe(true);
      expect((repository as any).executeCommand).toHaveBeenCalledWith(
        'DELETE FROM test_table WHERE id = ?',
        [1]
      );
    });

    it('should return false if no rows affected', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockResolvedValue(0);

      const result = await repository.delete(999);

      expect(result).toBe(false);
    });

    it('should throw DatabaseError on delete failure', async () => {
      jest.spyOn(repository as any, 'executeCommand').mockRejectedValue(new Error('DB error'));

      await expect(repository.delete(1)).rejects.toThrow(DatabaseError);
    });
  });

  describe('count', () => {
    it('should return count of entities', async () => {
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue({ count: 5 });

      const result = await repository.count();

      expect(result).toBe(5);
      expect((repository as any).executeQueryOne).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM test_table'
      );
    });

    it('should return 0 if count is null', async () => {
      jest.spyOn(repository as any, 'executeQueryOne').mockResolvedValue(null);

      const result = await repository.count();

      expect(result).toBe(0);
    });

    it('should throw DatabaseError on count failure', async () => {
      jest.spyOn(repository as any, 'executeQueryOne').mockRejectedValue(new Error('DB error'));

      await expect(repository.count()).rejects.toThrow(DatabaseError);
    });
  });
});

