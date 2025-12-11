"use strict";
/**
 * Extract Command Handler
 * ======================
 * Handles the /extract command for extracting CA drops from chat messages
 * and saving them to the database.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtractCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const child_process_1 = require("child_process");
const util_1 = require("util");
const logger_1 = require("../utils/logger");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class ExtractCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'extract';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        try {
            await ctx.reply('📥 **Extracting CA Drops from Messages...**\n\nProcessing HTML files in the messages folder...');
            // Run the extraction script
            const { stdout, stderr } = await execAsync('node extract_ca_drops_v2.js');
            if (stderr) {
                logger_1.logger.warn('Extraction stderr', { stderr, userId });
            }
            // Parse the output to get extraction results
            const lines = stdout.split('\n');
            const extractedCount = lines.find((line) => line.includes('Extracted'))?.match(/(\d+)/)?.[1] || '0';
            const savedCount = lines.find((line) => line.includes('Saved'))?.match(/(\d+)/)?.[1] || '0';
            await ctx.reply(`✅ **Extraction Complete!**\n\n` +
                `📊 **Results:**\n` +
                `• Extracted: ${extractedCount} CA drops\n` +
                `• Saved to database: ${savedCount}\n\n` +
                `Use \`/analysis\` to run historical analysis on the extracted data.`, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Extraction command error', error, { userId });
            await this.sendError(ctx, '❌ **Extraction Failed**\n\n' +
                'An error occurred during CA extraction. Make sure the messages folder exists and contains HTML files.');
        }
    }
}
exports.ExtractCommandHandler = ExtractCommandHandler;
//# sourceMappingURL=ExtractCommandHandler.js.map