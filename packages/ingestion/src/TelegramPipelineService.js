"use strict";
/**
 * Telegram Pipeline Service
 *
 * Service layer for Telegram DuckDB pipeline operations.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramPipelineService = exports.TelegramPipelineResultSchema = void 0;
const utils_1 = require("@quantbot/utils");
const utils_2 = require("@quantbot/utils");
/**
 * Schema for Telegram pipeline result (re-exported from PythonEngine)
 */
exports.TelegramPipelineResultSchema = utils_1.PythonManifestSchema;
/**
 * Telegram Pipeline Service
 */
class TelegramPipelineService {
    pythonEngine;
    constructor(pythonEngine) {
        this.pythonEngine = pythonEngine;
    }
    /**
     * Run Telegram DuckDB pipeline
     *
     * @param inputFile - Path to Telegram JSON export file
     * @param outputDb - Path to output DuckDB file
     * @param chatId - Chat ID to process
     * @param rebuild - Whether to rebuild DuckDB from scratch
     * @returns Validated manifest
     */
    async runPipeline(inputFile, outputDb, chatId, rebuild) {
        try {
            const result = await this.pythonEngine.runTelegramPipeline({
                inputFile,
                outputDb,
                chatId,
                rebuild,
            });
            // PythonEngine already validates with PythonManifestSchema
            // Re-validate here for extra safety
            return exports.TelegramPipelineResultSchema.parse(result);
        }
        catch (error) {
            utils_2.logger.error('Failed to run Telegram pipeline', error);
            throw error; // Re-throw to let handler handle it
        }
    }
}
exports.TelegramPipelineService = TelegramPipelineService;
//# sourceMappingURL=TelegramPipelineService.js.map