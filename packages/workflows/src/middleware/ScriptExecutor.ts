/**
 * Script Executor Middleware
 * ===========================
 * Composable middleware system for building reusable script workflows.
 * Allows parameterized execution without writing new scripts for each workflow.
 */

import { logger } from '@quantbot/utils';

export interface ScriptContext<TInput = any, TOutput = any> {
  input: TInput;
  output?: TOutput;
  metadata: {
    startTime: Date;
    processed: number;
    success: number;
    failed: number;
    errors: Array<{ item: any; error: string }>;
  };
}

export interface ScriptMiddleware<TInput = any, TOutput = any> {
  name: string;
  execute: (context: ScriptContext<TInput, TOutput>) => Promise<ScriptContext<TInput, TOutput>>;
}

export interface ScriptConfig {
  name: string;
  description?: string;
  rateLimitMs?: number;
  batchSize?: number;
  continueOnError?: boolean;
  progressInterval?: number; // Log progress every N items
}

/**
 * Script Executor - Composable middleware system
 */
export class ScriptExecutor<TInput = any, TOutput = any> {
  private middlewares: ScriptMiddleware<TInput, TOutput>[] = [];
  private config: ScriptConfig;

  constructor(config: ScriptConfig) {
    this.config = {
      rateLimitMs: 1000,
      batchSize: 1,
      continueOnError: true,
      progressInterval: 10,
      ...config,
    };
  }

  /**
   * Add middleware to the execution pipeline
   */
  use(middleware: ScriptMiddleware<TInput, TOutput>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Execute the script with given input
   */
  async execute(input: TInput): Promise<ScriptContext<TInput, TOutput>> {
    const context: ScriptContext<TInput, TOutput> = {
      input,
      metadata: {
        startTime: new Date(),
        processed: 0,
        success: 0,
        failed: 0,
        errors: [],
      },
    };

    logger.info(`Starting script: ${this.config.name}`, {
      description: this.config.description,
      inputType: typeof input,
      middlewareCount: this.middlewares.length,
    });

    try {
      // Execute all middlewares in sequence
      let currentContext = context;
      for (const middleware of this.middlewares) {
        logger.debug(`Executing middleware: ${middleware.name}`);
        currentContext = await middleware.execute(currentContext);
      }

      const duration = Date.now() - currentContext.metadata.startTime.getTime();
      logger.info(`Script completed: ${this.config.name}`, {
        duration: `${(duration / 1000).toFixed(2)}s`,
        processed: currentContext.metadata.processed,
        success: currentContext.metadata.success,
        failed: currentContext.metadata.failed,
        successRate: currentContext.metadata.processed > 0
          ? `${((currentContext.metadata.success / currentContext.metadata.processed) * 100).toFixed(1)}%`
          : '0%',
      });

      return currentContext;
    } catch (error) {
      logger.error(`Script failed: ${this.config.name}`, error as Error);
      throw error;
    }
  }

  /**
   * Get middleware by name
   */
  getMiddleware(name: string): ScriptMiddleware<TInput, TOutput> | undefined {
    return this.middlewares.find(m => m.name === name);
  }
}

