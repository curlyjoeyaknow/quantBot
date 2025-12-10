"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPostgresPool = getPostgresPool;
exports.getPostgresClient = getPostgresClient;
exports.queryPostgres = queryPostgres;
exports.withPostgresTransaction = withPostgresTransaction;
exports.closePostgresPool = closePostgresPool;
const pg_1 = require("pg");
const logger_1 = require("../utils/logger");
let pool = null;
function buildConfigFromEnv() {
    const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE, POSTGRES_MAX_CONNECTIONS, } = process.env;
    return {
        host: POSTGRES_HOST || 'localhost',
        port: POSTGRES_PORT ? Number(POSTGRES_PORT) : 5432,
        user: POSTGRES_USER || 'quantbot',
        password: POSTGRES_PASSWORD || '',
        database: POSTGRES_DATABASE || 'quantbot',
        maxConnections: POSTGRES_MAX_CONNECTIONS ? Number(POSTGRES_MAX_CONNECTIONS) : 10,
    };
}
function getPostgresPool() {
    if (pool) {
        return pool;
    }
    const config = buildConfigFromEnv();
    pool = new pg_1.Pool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password || undefined,
        database: config.database,
        max: config.maxConnections,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    });
    pool.on('error', (error) => {
        logger_1.logger.error('Postgres pool error', error, {
            host: config.host,
            database: config.database,
        });
    });
    logger_1.logger.info('Postgres pool created', {
        host: config.host,
        database: config.database,
    });
    return pool;
}
async function getPostgresClient() {
    const client = await getPostgresPool().connect();
    return client;
}
async function queryPostgres(text, params) {
    const client = await getPostgresClient();
    try {
        return await client.query(text, params);
    }
    finally {
        client.release();
    }
}
async function withPostgresTransaction(handler) {
    const client = await getPostgresClient();
    try {
        await client.query('BEGIN');
        const result = await handler(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK').catch((rollbackError) => {
            logger_1.logger.error('Postgres rollback failed', rollbackError);
        });
        throw error;
    }
    finally {
        client.release();
    }
}
async function closePostgresPool() {
    if (!pool) {
        return;
    }
    await pool.end();
    pool = null;
    logger_1.logger.info('Postgres pool closed');
}
//# sourceMappingURL=postgres-client.js.map