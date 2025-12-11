"use strict";
/**
 * PostgreSQL Database Manager for Web Dashboard
 * Replaces the old SQLite db-manager
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.postgresManager = void 0;
const pg_1 = require("pg");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
class PostgresManager {
    constructor() {
        this.pool = null;
    }
    static getInstance() {
        if (!PostgresManager.instance) {
            PostgresManager.instance = new PostgresManager();
        }
        return PostgresManager.instance;
    }
    getPool() {
        if (this.pool) {
            return this.pool;
        }
        this.pool = new pg_1.Pool({
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '5432'),
            user: process.env.POSTGRES_USER || 'quantbot',
            password: process.env.POSTGRES_PASSWORD || '',
            database: process.env.POSTGRES_DATABASE || 'quantbot',
            max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '10'),
        });
        return this.pool;
    }
    async getClient() {
        const pool = this.getPool();
        return await pool.connect();
    }
    async query(text, params) {
        const pool = this.getPool();
        return await pool.query(text, params);
    }
    async healthCheck() {
        try {
            const result = await this.query('SELECT 1');
            return result.rows.length > 0;
        }
        catch (error) {
            console.error('PostgreSQL health check failed:', error);
            return false;
        }
    }
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }
}
exports.postgresManager = PostgresManager.getInstance();
//# sourceMappingURL=postgres-manager.js.map