"use strict";
/**
 * Repository Pattern
 * ==================
 * Unified database interface and repository pattern for data access.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseRepository = void 0;
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
/**
 * Base repository implementation
 */
class BaseRepository {
    /**
     * Find entity by ID
     */
    async findById(id) {
        try {
            const row = await this.executeQueryOne(`SELECT * FROM ${this.tableName} WHERE ${this.idField} = ?`, [id]);
            return row ? this.mapRowToEntity(row) : null;
        }
        catch (error) {
            logger_1.logger.error('Error finding entity by ID', error, {
                table: this.tableName,
                id,
            });
            throw new errors_1.DatabaseError(`Failed to find ${this.tableName} by ID`, 'findById', { table: this.tableName, id });
        }
    }
    /**
     * Find all entities
     */
    async findAll(limit, offset) {
        try {
            let query = `SELECT * FROM ${this.tableName}`;
            const params = [];
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
        }
        catch (error) {
            logger_1.logger.error('Error finding all entities', error, {
                table: this.tableName,
                limit,
                offset,
            });
            throw new errors_1.DatabaseError(`Failed to find all ${this.tableName}`, 'findAll', { table: this.tableName });
        }
    }
    /**
     * Create a new entity
     */
    async create(entity) {
        try {
            const row = this.mapEntityToRow(entity);
            const fields = Object.keys(row);
            const values = Object.values(row);
            const placeholders = fields.map(() => '?').join(', ');
            const query = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders})`;
            const insertId = await this.executeCommand(query, values);
            // Fetch the created entity
            const created = await this.findById(insertId);
            if (!created) {
                throw new errors_1.NotFoundError(this.tableName, String(insertId));
            }
            return created;
        }
        catch (error) {
            if (error instanceof errors_1.NotFoundError || error instanceof errors_1.DatabaseError) {
                throw error;
            }
            logger_1.logger.error('Error creating entity', error, {
                table: this.tableName,
                entity,
            });
            throw new errors_1.DatabaseError(`Failed to create ${this.tableName}`, 'create', { table: this.tableName });
        }
    }
    /**
     * Update an entity
     */
    async update(id, entity) {
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
                throw new errors_1.NotFoundError(this.tableName, String(id));
            }
            return updated;
        }
        catch (error) {
            if (error instanceof errors_1.NotFoundError || error instanceof errors_1.DatabaseError) {
                throw error;
            }
            logger_1.logger.error('Error updating entity', error, {
                table: this.tableName,
                id,
            });
            throw new errors_1.DatabaseError(`Failed to update ${this.tableName}`, 'update', { table: this.tableName, id });
        }
    }
    /**
     * Delete an entity
     */
    async delete(id) {
        try {
            const query = `DELETE FROM ${this.tableName} WHERE ${this.idField} = ?`;
            const affectedRows = await this.executeCommand(query, [id]);
            return affectedRows > 0;
        }
        catch (error) {
            logger_1.logger.error('Error deleting entity', error, {
                table: this.tableName,
                id,
            });
            throw new errors_1.DatabaseError(`Failed to delete ${this.tableName}`, 'delete', { table: this.tableName, id });
        }
    }
    /**
     * Count total entities
     */
    async count() {
        try {
            const result = await this.executeQueryOne(`SELECT COUNT(*) as count FROM ${this.tableName}`);
            return result?.count || 0;
        }
        catch (error) {
            logger_1.logger.error('Error counting entities', error, {
                table: this.tableName,
            });
            throw new errors_1.DatabaseError(`Failed to count ${this.tableName}`, 'count', { table: this.tableName });
        }
    }
}
exports.BaseRepository = BaseRepository;
//# sourceMappingURL=repository.js.map