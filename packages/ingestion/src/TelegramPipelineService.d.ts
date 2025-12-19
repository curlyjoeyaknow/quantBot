/**
 * Telegram Pipeline Service
 *
 * Service layer for Telegram DuckDB pipeline operations.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */
import type { PythonEngine, PythonManifest } from '@quantbot/utils';
/**
 * Schema for Telegram pipeline result (re-exported from PythonEngine)
 */
export declare const TelegramPipelineResultSchema: import('zod').ZodType<
  import('@quantbot/utils').PythonManifest
>;
export type TelegramPipelineResult = PythonManifest;
/**
 * Telegram Pipeline Service
 */
export declare class TelegramPipelineService {
  private readonly pythonEngine;
  constructor(pythonEngine: PythonEngine);
  /**
   * Run Telegram DuckDB pipeline
   *
   * @param inputFile - Path to Telegram JSON export file
   * @param outputDb - Path to output DuckDB file
   * @param chatId - Chat ID to process
   * @param rebuild - Whether to rebuild DuckDB from scratch
   * @returns Validated manifest
   */
  runPipeline(
    inputFile: string,
    outputDb: string,
    chatId: string,
    rebuild?: boolean
  ): Promise<TelegramPipelineResult>;
}
//# sourceMappingURL=TelegramPipelineService.d.ts.map
