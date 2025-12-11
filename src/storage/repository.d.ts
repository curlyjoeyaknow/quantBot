/**
 * Repository Pattern
 * ==================
 * Unified database interface and repository pattern for data access.
 */
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
export declare abstract class BaseRepository<T, ID = string | number> implements IRepository<T, ID> {
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
    findById(id: ID): Promise<T | null>;
    /**
     * Find all entities
     */
    findAll(limit?: number, offset?: number): Promise<T[]>;
    /**
     * Create a new entity
     */
    create(entity: Partial<T>): Promise<T>;
    /**
     * Update an entity
     */
    update(id: ID, entity: Partial<T>): Promise<T>;
    /**
     * Delete an entity
     */
    delete(id: ID): Promise<boolean>;
    /**
     * Count total entities
     */
    count(): Promise<number>;
}
//# sourceMappingURL=repository.d.ts.map