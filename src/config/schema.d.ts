/**
 * Configuration Schema
 * ====================
 * Zod schemas for validating environment variables and configuration.
 */
import { z } from 'zod';
/**
 * Environment configuration schema
 */
export declare const envSchema: z.ZodObject<{
    BOT_TOKEN: z.ZodString;
    TELEGRAM_BOT_TOKEN: z.ZodOptional<z.ZodString>;
    CALLER_DB_PATH: z.ZodDefault<z.ZodString>;
    CLICKHOUSE_HOST: z.ZodDefault<z.ZodString>;
    CLICKHOUSE_USER: z.ZodDefault<z.ZodString>;
    CLICKHOUSE_PASSWORD: z.ZodDefault<z.ZodString>;
    CLICKHOUSE_DATABASE: z.ZodDefault<z.ZodString>;
    INFLUXDB_URL: z.ZodOptional<z.ZodString>;
    INFLUXDB_TOKEN: z.ZodOptional<z.ZodString>;
    INFLUXDB_ORG: z.ZodOptional<z.ZodString>;
    INFLUXDB_BUCKET: z.ZodOptional<z.ZodString>;
    BIRDEYE_API_KEY: z.ZodOptional<z.ZodString>;
    HELIUS_API_KEY: z.ZodOptional<z.ZodString>;
    SHYFT_API_KEY: z.ZodOptional<z.ZodString>;
    SHYFT_X_TOKEN: z.ZodOptional<z.ZodString>;
    SHYFT_WS_URL: z.ZodOptional<z.ZodString>;
    SHYFT_GRPC_URL: z.ZodOptional<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        error: "error";
        warn: "warn";
        info: "info";
        debug: "debug";
        trace: "trace";
    }>>;
    LOG_CONSOLE: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<boolean, string | undefined>>;
    LOG_FILE: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<boolean, string | undefined>>;
    LOG_DIR: z.ZodDefault<z.ZodString>;
    LOG_MAX_FILES: z.ZodDefault<z.ZodString>;
    LOG_MAX_SIZE: z.ZodDefault<z.ZodString>;
    NODE_ENV: z.ZodDefault<z.ZodEnum<{
        production: "production";
        test: "test";
        development: "development";
    }>>;
    PORT: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>>;
    ENABLE_MONITORING: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<boolean, string | undefined>>;
    ENABLE_ALERTS: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<boolean, string | undefined>>;
}, z.core.$strip>;
/**
 * Type for validated environment configuration
 */
export type EnvConfig = z.infer<typeof envSchema>;
//# sourceMappingURL=schema.d.ts.map