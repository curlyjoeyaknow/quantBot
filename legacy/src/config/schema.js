"use strict";
/**
 * Configuration Schema
 * ====================
 * Zod schemas for validating environment variables and configuration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.envSchema = void 0;
const zod_1 = require("zod");
/**
 * Environment configuration schema
 */
exports.envSchema = zod_1.z.object({
    // Bot Configuration
    BOT_TOKEN: zod_1.z.string().min(1, 'BOT_TOKEN is required'),
    TELEGRAM_BOT_TOKEN: zod_1.z.string().optional(), // Fallback for BOT_TOKEN
    // Database Configuration
    CALLER_DB_PATH: zod_1.z.string().default('./caller_alerts.db'),
    CLICKHOUSE_HOST: zod_1.z.string().default('http://localhost:8123'),
    CLICKHOUSE_USER: zod_1.z.string().default('default'),
    CLICKHOUSE_PASSWORD: zod_1.z.string().default(''),
    CLICKHOUSE_DATABASE: zod_1.z.string().default('quantbot'),
    // InfluxDB Configuration
    INFLUXDB_URL: zod_1.z.string().optional(),
    INFLUXDB_TOKEN: zod_1.z.string().optional(),
    INFLUXDB_ORG: zod_1.z.string().optional(),
    INFLUXDB_BUCKET: zod_1.z.string().optional(),
    // API Keys
    BIRDEYE_API_KEY: zod_1.z.string().optional(),
    HELIUS_API_KEY: zod_1.z.string().optional(),
    SHYFT_API_KEY: zod_1.z.string().optional(),
    SHYFT_X_TOKEN: zod_1.z.string().optional(),
    SHYFT_WS_URL: zod_1.z.string().optional(),
    SHYFT_GRPC_URL: zod_1.z.string().optional(),
    // Logging Configuration
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_CONSOLE: zod_1.z.string().optional().transform(val => val !== 'false'),
    LOG_FILE: zod_1.z.string().optional().transform(val => val !== 'false'),
    LOG_DIR: zod_1.z.string().default('./logs'),
    LOG_MAX_FILES: zod_1.z.string().default('14d'),
    LOG_MAX_SIZE: zod_1.z.string().default('20m'),
    // Application Configuration
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.string().transform(Number).optional(),
    // Feature Flags
    ENABLE_MONITORING: zod_1.z.string().optional().transform(val => val === 'true'),
    ENABLE_ALERTS: zod_1.z.string().optional().transform(val => val === 'true'),
});
//# sourceMappingURL=schema.js.map