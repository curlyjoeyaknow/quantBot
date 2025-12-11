/**
 * Store Middleware
 * ================
 * Reusable middleware for storing results (database inserts, file writes, etc.)
 */

import { ScriptContext, ScriptMiddleware } from './ScriptExecutor';
import { logger } from '@quantbot/utils';

export interface StoreConfig<TItem = any> {
  storer: (item: TItem, index: number, total: number) => Promise<void>;
  batchSize?: number;
  continueOnError?: boolean;
}

/**
 * Store middleware - Stores processed results
 */
export function createStoreMiddleware<TInput = any[], TOutput = any[]>(
  config: StoreConfig
): ScriptMiddleware<TInput, TOutput> {
  return {
    name: 'store',
    execute: async (context: ScriptContext<TInput, TOutput>) => {
      const items = Array.isArray(context.output) ? context.output : [context.output];
      const batchSize = config.batchSize || 1;
      const continueOnError = config.continueOnError !== false;

      logger.info(`Storing ${items.length} items`);

      let stored = 0;
      const errors: Array<{ item: any; error: string }> = [];

      // Process in batches if batchSize > 1
      if (batchSize > 1) {
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);
          
          try {
            await Promise.all(
              batch.map((item, batchIndex) =>
                config.storer(item, i + batchIndex, items.length)
              )
            );
            stored += batch.length;
          } catch (error: any) {
            const errorMsg = error.message || String(error);
            logger.warn(`Failed to store batch starting at index ${i}`, { error: errorMsg });
            
            if (!continueOnError) {
              throw error;
            }
            
            // Try storing items individually
            for (const item of batch) {
              try {
                await config.storer(item, i, items.length);
                stored++;
              } catch (err: any) {
                errors.push({ item, error: err.message || String(err) });
              }
            }
          }
        }
      } else {
        // Process individually
        for (let i = 0; i < items.length; i++) {
          try {
            await config.storer(items[i], i, items.length);
            stored++;
          } catch (error: any) {
            const errorMsg = error.message || String(error);
            logger.warn(`Failed to store item at index ${i}`, { error: errorMsg });
            errors.push({ item: items[i], error: errorMsg });

            if (!continueOnError) {
              throw error;
            }
          }
        }
      }

      logger.info(`Storage complete: ${stored}/${items.length} stored`);

      return {
        ...context,
        metadata: {
          ...context.metadata,
          errors: [...context.metadata.errors, ...errors],
        },
      };
    },
  };
}

