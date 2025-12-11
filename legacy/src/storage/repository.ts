/**
 * Repository Pattern
 * ==================
 * Unified database interface and repository pattern for data access.
 */

import { DatabaseError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Base repository interface
 */
export interface IRepository<T, ID = string | number> {
  findById(id: ID): Promise<T | null>;
  findAll(limit?: number, offset?: number): Promise<T[]>;
  create(entity: Partial<T>): Promise<T>;
  update(id: ID, entity: Partial<T>): Promise<T>;
  delete(id: ID): Promise<boolean>;
  count(): Promise<number>;
}

/**
 * Base repository implementation
 */
export abstract class BaseRepository<T, ID = string | number> implements IRepository<T, ID> {
  protected abstract tableName: string;
  protected abstract idField: string;

  /**
   * Execute a query and return results
   */
  protected abstract executeQuery<R = any>(query: string, params?: any[]): Promise<R[]>;

  /**
   * Execute a query and return a single result
   */
  protected abstract executeQueryOne<R = any>(query: string, params?: any[]): Promise<R | null>;

  /**
   * Execute a command (INSERT, UPDATE, DELETE)
   */
  protected abstract executeCommand(query: string, params?: any[]): Promise<number>;

  /**
   * Map database row to entity
   */
  protected abstract mapRowToEntity(row: any): T;

  /**
   * Map entity to database row
   */
  protected abstract mapEntityToRow(entity: Partial<T>): Record<string, any>;

  /**
   * Find entity by ID
   */
  async findById(id: ID): Promise<T | null> {
    try {
      const row = await this.executeQueryOne(
        `SELECT * FROM ${this.tableName} WHERE ${this.idField} = ?`,
        [id]
      );
      return row ? this.mapRowToEntity(row) : null;
    } catch (error) {
      logger.error('Error finding entity by ID', error as Error, {
        table: this.tableName,
        id,
      });
      throw new DatabaseError(
        `Failed to find ${this.tableName} by ID`,
        'findById',
        { table: this.tableName, id }
      );
    }
  }

  /**
   * Find all entities
   */
  async findAll(limit?: number, offset?: number): Promise<T[]> {
    try {
      let query = `SELECT * FROM ${this.tableName}`;
      const params: any[] = [];

      if (limit) {
        query += ' LIMIT ?';
        params.push(limit);
      }

      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }

      const rows = await this.executeQuery(query, params);
      return rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      logger.error('Error finding all entities', error as Error, {
        table: this.tableName,
        limit,
        offset,
      });
      throw new DatabaseError(
        `Failed to find all ${this.tableName}`,
        'findAll',
        { table: this.tableName }
      );
    }
  }

  /**
   * Create a new entity
   */
  async create(entity: Partial<T>): Promise<T> {
    try {
      const row = this.mapEntityToRow(entity);
      const fields = Object.keys(row);
      const values = Object.values(row);
      const placeholders = fields.map(() => '?').join(', ');

      const query = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders})`;
      const insertId = await this.executeCommand(query, values);

      // Fetch the created entity
      const created = await this.findById(insertId as ID);
      if (!created) {
        throw new NotFoundError(this.tableName, String(insertId));
      }

      return created;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof DatabaseError) {
        throw error;
      }
      logger.error('Error creating entity', error as Error, {
        table: this.tableName,
        entity,
      });
      throw new DatabaseError(
        `Failed to create ${this.tableName}`,
        'create',
        { table: this.tableName }
      );
    }
  }

  /**
   * Update an entity
   */
  async update(id: ID, entity: Partial<T>): Promise<T> {
    try {
      const row = this.mapEntityToRow(entity);
      const fields = Object.keys(row).filter(key => key !== this.idField);
      const values = Object.values(row).filter((_, idx) => fields[idx] !== this.idField);
      const setClause = fields.map(field => `${field} = ?`).join(', ');

      const query = `UPDATE ${this.tableName} SET ${setClause} WHERE ${this.idField} = ?`;
      await this.executeCommand(query, [...values, id]);

      // Fetch the updated entity
      const updated = await this.findById(id);
      if (!updated) {
        throw new NotFoundError(this.tableName, String(id));
      }

      return updated;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof DatabaseError) {
        throw error;
      }
      logger.error('Error updating entity', error as Error, {
        table: this.tableName,
        id,
      });
      throw new DatabaseError(
        `Failed to update ${this.tableName}`,
        'update',
        { table: this.tableName, id }
      );
    }
  }

  /**
   * Delete an entity
   */
  async delete(id: ID): Promise<boolean> {
    try {
      const query = `DELETE FROM ${this.tableName} WHERE ${this.idField} = ?`;
      const affectedRows = await this.executeCommand(query, [id]);
      return affectedRows > 0;
    } catch (error) {
      logger.error('Error deleting entity', error as Error, {
        table: this.tableName,
        id,
      });
      throw new DatabaseError(
        `Failed to delete ${this.tableName}`,
        'delete',
        { table: this.tableName, id }
      );
    }
  }

  /**
   * Count total entities
   */
  async count(): Promise<number> {
    try {
      const result = await this.executeQueryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM ${this.tableName}`
      );
      return result?.count || 0;
    } catch (error) {
      logger.error('Error counting entities', error as Error, {
        table: this.tableName,
      });
      throw new DatabaseError(
        `Failed to count ${this.tableName}`,
        'count',
        { table: this.tableName }
      );
    }
  }
}

