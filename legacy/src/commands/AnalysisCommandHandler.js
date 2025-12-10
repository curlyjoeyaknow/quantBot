"use strict";
/**
 * Analysis Command Handler
 * ========================
 * Handles the /analysis command for running historical analysis on CA drops
 * and formatting/sending the results.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const logger_1 = require("../utils/logger");
class AnalysisCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'analysis';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        try {
            await ctx.reply('🔍 **Starting Historical Analysis...**\n\nThis may take a few minutes while fetching current prices for all tracked CAs...');
            // Import and run the analysis
            const { HistoricalAnalyzer } = require('../historical_analysis');
            const analyzer = new HistoricalAnalyzer();
            await analyzer.init();
            const analysis = await analyzer.runAnalysis();
            await analyzer.close();
            // Send the formatted report
            const report = analyzer.formatAnalysisResults(analysis);
            // Split long messages if needed
            const maxLength = 4000;
            if (report.length > maxLength) {
                const parts = [];
                let currentPart = '';
                const lines = report.split('\n');
                for (const line of lines) {
                    if (currentPart.length + line.length > maxLength) {
                        parts.push(currentPart);
                        currentPart = line + '\n';
                    }
                    else {
                        currentPart += line + '\n';
                    }
                }
                if (currentPart)
                    parts.push(currentPart);
                for (let i = 0; i < parts.length; i++) {
                    await ctx.reply(parts[i], { parse_mode: 'Markdown' });
                    if (i < parts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between messages
                    }
                }
            }
            else {
                await ctx.reply(report, { parse_mode: 'Markdown' });
            }
        }
        catch (error) {
            logger_1.logger.error('Analysis command error', error, { userId });
            await this.sendError(ctx, '❌ **Analysis Failed**\n\n' +
                'An error occurred during the historical analysis. Please try again later.');
        }
    }
}
exports.AnalysisCommandHandler = AnalysisCommandHandler;
//# sourceMappingURL=AnalysisCommandHandler.js.map