/**
 * Configuration Schema
 * ====================
 * Zod schemas for validating environment variables and configuration.
 */

import { z } from 'zod';
import * as path from 'path';

/**
 * Environment configuration schema
 */
export const envSchema = z.object({
  // Bot Configuration
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  TELEGRAM_BOT_TOKEN: z.string().optional(), // Fallback for BOT_TOKEN
  
  // Database Configuration
  CALLER_DB_PATH: z.string().default(path.join(process.cwd(), 'data', 'databases', 'caller_alerts.db')),
  CLICKHOUSE_HOST: z.string().default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().default(''),
  CLICKHOUSE_DATABASE: z.string().default('quantbot'),
  
  // InfluxDB Configuration
  INFLUXDB_URL: z.string().optional(),
  INFLUXDB_TOKEN: z.string().optional(),
  INFLUXDB_ORG: z.string().optional(),
  INFLUXDB_BUCKET: z.string().optional(),
  
  // API Keys
  BIRDEYE_API_KEY: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  SHYFT_API_KEY: z.string().optional(),
  SHYFT_X_TOKEN: z.string().optional(),
  SHYFT_WS_URL: z.string().optional(),
  SHYFT_GRPC_URL: z.string().optional(),
  
  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_CONSOLE: z.string().optional().transform(val => val !== 'false'),
  LOG_FILE: z.string().optional().transform(val => val !== 'false'),
  LOG_DIR: z.string().default('./logs'),
  LOG_MAX_FILES: z.string().default('14d'),
  LOG_MAX_SIZE: z.string().default('20m'),
  
  // Application Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).optional(),
  
  // Feature Flags
  ENABLE_MONITORING: z.string().optional().transform(val => val === 'true'),
  ENABLE_ALERTS: z.string().optional().transform(val => val === 'true'),
});

/**
 * Type for validated environment configuration
 */
export type EnvConfig = z.infer<typeof envSchema>;

