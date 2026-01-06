/**
 * Telegram Pipeline Service
 *
 * Service layer for Telegram DuckDB pipeline operations.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */

import type { PythonEngine, PythonManifest } from '@quantbot/infra/utils';
import { PythonManifestSchema } from '@quantbot/infra/utils';
import { logger } from '@quantbot/infra/utils';

/**
 * Schema for Telegram pipeline result (re-exported from PythonEngine)
 */
export const TelegramPipelineResultSchema: typeof PythonManifestSchema = PythonManifestSchema;

export type TelegramPipelineResult = PythonManifest;

/**
 * Telegram Pipeline Service
 */
export class TelegramPipelineService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run Telegram DuckDB pipeline
   *
   * @param inputFile - Path to Telegram JSON export file
   * @param outputDb - Path to output DuckDB file
   * @param chatId - Chat ID to process (optional - will be extracted from file if single chat)
   * @param rebuild - Whether to rebuild DuckDB from scratch
   * @param options - Python script execution options (timeout, etc.)
   * @returns Validated manifest
   */
  async runPipeline(
    inputFile: string,
    outputDb: string,
    chatId?: string,
    rebuild?: boolean,
    options?: { timeout?: number }
  ): Promise<TelegramPipelineResult> {
    try {
      const result = await this.pythonEngine.runTelegramPipeline(
        {
          inputFile,
          outputDb,
          chatId,
          rebuild,
        },
        options ? { timeout: options.timeout } : undefined
      );

      // PythonEngine already validates with PythonManifestSchema
      // Re-validate here for extra safety
      return TelegramPipelineResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to run Telegram pipeline', error as Error);
      throw error; // Re-throw to let handler handle it
    }
  }
}
