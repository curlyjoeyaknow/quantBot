/**
 * Telegram Pipeline Service
 *
 * Service layer for Telegram DuckDB pipeline operations.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */

import { z } from 'zod';
import type { PythonEngine, PythonManifest } from '@quantbot/utils';
import { PythonManifestSchema } from '@quantbot/utils';
import { logger } from '@quantbot/utils';

/**
 * Schema for Telegram pipeline result (re-exported from PythonEngine)
 */
export const TelegramPipelineResultSchema = PythonManifestSchema;

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
   * @param chatId - Chat ID to process
   * @param rebuild - Whether to rebuild DuckDB from scratch
   * @returns Validated manifest
   */
  async runPipeline(
    inputFile: string,
    outputDb: string,
    chatId: string,
    rebuild?: boolean
  ): Promise<TelegramPipelineResult> {
    try {
      const result = await this.pythonEngine.runTelegramPipeline({
        inputFile,
        outputDb,
        chatId,
        rebuild,
      });

      // PythonEngine already validates with PythonManifestSchema
      // Re-validate here for extra safety
      return TelegramPipelineResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to run Telegram pipeline', error as Error);
      throw error; // Re-throw to let handler handle it
    }
  }
}
