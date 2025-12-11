/**
 * Query Middleware
 * ================
 * Reusable middleware for querying data sources (PostgreSQL, ClickHouse, etc.)
 */

import { Pool } from 'pg';
import { ScriptContext, ScriptMiddleware } from './ScriptExecutor';
import { logger } from '@quantbot/utils';

export interface QueryConfig {
  type: 'postgres' | 'clickhouse' | 'custom';
  query: string;
  params?: any[];
  transform?: (row: any) => any;
  pool?: Pool; // For postgres
  client?: any; // For clickhouse
}

/**
 * Query middleware - Fetches data from database
 */
export function createQueryMiddleware<TInput = any, TOutput = any>(
  config: QueryConfig
): ScriptMiddleware<TInput, TOutput> {
  return {
    name: 'query',
    execute: async (context: ScriptContext<TInput, TOutput>) => {
      logger.debug('Executing query middleware', { queryType: config.type });

      let results: any[] = [];

      try {
        if (config.type === 'postgres' && config.pool) {
          const result = await config.pool.query(config.query, config.params || []);
          results = result.rows;
        } else if (config.type === 'clickhouse' && config.client) {
          const result = await config.client.query({
            query: config.query,
            query_params: config.params || {},
            format: 'JSONEachRow',
          });
          const stream = result.stream();
          const rows: any[] = [];
          for await (const chunk of stream) {
            rows.push(...chunk);
          }
          results = rows;
        } else if (config.type === 'custom') {
          // Custom query function should be provided via transform
          throw new Error('Custom query type requires custom implementation');
        } else {
          throw new Error(`Invalid query configuration for type: ${config.type}`);
        }

        // Transform results if transform function provided
        if (config.transform) {
          results = results.map(config.transform);
        }

        logger.info(`Query returned ${results.length} rows`);

        // Store results in context output
        return {
          ...context,
          output: results as any,
        };
      } catch (error) {
        logger.error('Query middleware failed', error as Error);
        throw error;
      }
    },
  };
}

