/**
 * Process Middleware
 * ==================
 * Reusable middleware for processing items (fetching OHLCV, running simulations, etc.)
 */

import { ScriptContext, ScriptMiddleware } from './ScriptExecutor';
import { logger } from '@quantbot/utils';

export interface ProcessConfig<TItem = any, TResult = any> {
  processor: (item: TItem, index: number, total: number) => Promise<TResult>;
  rateLimitMs?: number;
  continueOnError?: boolean;
  progressInterval?: number;
  batchSize?: number;
}

/**
 * Process middleware - Processes each item in the input array
 */
export function createProcessMiddleware<TInput = any[], TOutput = any[]>(
  config: ProcessConfig
): ScriptMiddleware<TInput, TOutput> {
  return {
    name: 'process',
    execute: async (context: ScriptContext<TInput, TOutput>) => {
      const items = Array.isArray(context.input) ? context.input : [context.input];
      const rateLimitMs = config.rateLimitMs || 1000;
      const continueOnError = config.continueOnError !== false;
      const progressInterval = config.progressInterval || 10;

      logger.info(`Processing ${items.length} items`);

      const results: any[] = [];
      const errors: Array<{ item: any; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const progress = `[${i + 1}/${items.length}]`;

        try {
          logger.debug(`${progress} Processing item`, { index: i });

          const result = await config.processor(item, i, items.length);
          results.push(result);

          context.metadata.processed++;
          context.metadata.success++;

          // Log progress periodically
          if ((i + 1) % progressInterval === 0) {
            logger.info(`Progress: ${i + 1}/${items.length} (${context.metadata.success} success, ${context.metadata.failed} failed)`);
          }

          // Rate limiting
          if (i < items.length - 1 && rateLimitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, rateLimitMs));
          }
        } catch (error: any) {
          const errorMsg = error.message || String(error);
          logger.warn(`${progress} Failed to process item`, { error: errorMsg });

          context.metadata.failed++;
          errors.push({ item, error: errorMsg });

          if (!continueOnError) {
            throw error;
          }
        }
      }

      logger.info(`Processing complete: ${results.length} successful, ${errors.length} failed`);

      return {
        ...context,
        output: results as any,
        metadata: {
          ...context.metadata,
          errors: [...context.metadata.errors, ...errors],
        },
      };
    },
  };
}

